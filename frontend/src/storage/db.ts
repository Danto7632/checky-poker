// The storage backend: IndexedDB through idb (storage.idb.v1), or an in-memory twin when IndexedDB cannot be
// opened (E-STO-UNAVAILABLE — private mode, policy). Both implement the same small Backend so profile, device,
// settings and hands are written once. The memory twin loses everything when the tab closes; the game still
// works (SC3).
import { wrap, type DBSchema, type IDBPDatabase } from 'idb';
import type { HandRecordV1, HandSummary, RecordMode } from '@checky/engine/record';
import { DB_NAME, DB_VERSION, runMigrations } from './migrations';
import { mapWriteError } from './errors';

export interface HandRow {
  id: string;
  v: 1;
  playedAt: string;
  mode: RecordMode;
  fav: 0 | 1;
  summary: HandSummary;
  body: HandRecordV1;
}

export type KvStore = 'meta' | 'device' | 'profile' | 'settings';
export type KvRow = { key: string } & Record<string, unknown>;

/** (playedAt, id) of the last row of a page — rows are ordered by playedAt desc, then id desc. */
export type ListCursor = readonly [playedAt: string, id: string];

export interface Backend {
  readonly kind: 'idb' | 'memory';
  get(store: KvStore, key: string): Promise<KvRow | undefined>;
  put(store: KvStore, row: KvRow): Promise<void>;
  /** Atomic get-or-create (one transaction), so two first-time callers cannot create two device secrets. */
  getOrCreate(store: KvStore, key: string, make: () => KvRow): Promise<KvRow>;
  /** Read-merge-write in one readwrite transaction (put_rule: keep the stored fav and coaching). */
  putHand(row: HandRow, merge: (prev: HandRow | undefined, next: HandRow) => HandRow): Promise<void>;
  getHand(id: string): Promise<HandRow | undefined>;
  listHands(after: ListCursor | null, limit: number): Promise<HandRow[]>;
  countHands(): Promise<number>;
}

interface CheckyDb extends DBSchema {
  meta: { key: string; value: KvRow };
  device: { key: string; value: KvRow };
  profile: { key: string; value: KvRow };
  settings: { key: string; value: KvRow };
  hands: {
    key: string;
    value: HandRow;
    indexes: { by_time: string; by_mode_time: [string, string]; by_fav_time: [number, string] };
  };
}

export interface OpenHooks {
  /** Another tab holds an older version open and does not close it (E-STO-BLOCKED). */
  onBlocked(): void;
  /** A newer version is being opened elsewhere: this connection was closed and must not be used again. */
  onVersionChange(): void;
}

/** Opens `checky` v1 with an injectable factory (tests pass a fresh fake-indexeddb IDBFactory). */
export async function openIdbBackend(factory: IDBFactory, hooks: OpenHooks): Promise<Backend> {
  const request = factory.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = (e) => runMigrations(request.result, request.transaction!, e.oldVersion, e.newVersion ?? DB_VERSION);
  request.onblocked = () => hooks.onBlocked();
  const raw = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
  raw.onversionchange = () => {
    raw.close();
    hooks.onVersionChange();
  };
  return idbBackend(wrap(raw) as IDBPDatabase<CheckyDb>);
}

function idbBackend(db: IDBPDatabase<CheckyDb>): Backend {
  const write = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      return mapWriteError(e);
    }
  };
  return {
    kind: 'idb',
    get: (store, key) => db.get(store, key),
    put: (store, row) => write(async () => void (await db.put(store, row))),
    getOrCreate: (store, key, make) =>
      write(async () => {
        const tx = db.transaction(store, 'readwrite');
        // make() is synchronous: awaiting anything else inside the transaction would let it auto-commit.
        const existing = await tx.store.get(key);
        const row = existing ?? make();
        if (existing === undefined) await tx.store.put(row);
        await tx.done;
        return row;
      }),
    putHand: (row, merge) =>
      write(async () => {
        const tx = db.transaction('hands', 'readwrite');
        const prev = await tx.store.get(row.id);
        await tx.store.put(merge(prev, row));
        await tx.done;
      }),
    getHand: (id) => db.get('hands', id),
    listHands: async (after, limit) => {
      const range = after === null ? null : IDBKeyRange.upperBound(after[0]);
      const out: HandRow[] = [];
      let cursor = await db.transaction('hands').store.index('by_time').openCursor(range, 'prev');
      while (cursor !== null && out.length < limit) {
        const row = cursor.value;
        // Same playedAt rows come in descending id order; skip the ones already returned.
        if (after === null || row.playedAt < after[0] || (row.playedAt === after[0] && row.id < after[1])) out.push(row);
        cursor = await cursor.continue();
      }
      return out;
    },
    countHands: () => db.count('hands'),
  };
}

export function createMemoryBackend(): Backend {
  const kv = new Map<string, KvRow>();
  const hands = new Map<string, HandRow>();
  const k = (store: KvStore, key: string) => `${store}\u0000${key}`;
  // structuredClone keeps the same "stored copy" semantics as IndexedDB: callers cannot mutate stored rows.
  const copy = <T>(v: T): T => structuredClone(v);
  return {
    kind: 'memory',
    get: async (store, key) => {
      const row = kv.get(k(store, key));
      return row === undefined ? undefined : copy(row);
    },
    put: async (store, row) => {
      kv.set(k(store, row.key), copy(row));
    },
    getOrCreate: async (store, key, make) => {
      const existing = kv.get(k(store, key));
      if (existing !== undefined) return copy(existing);
      const row = make();
      kv.set(k(store, key), copy(row));
      return copy(row);
    },
    putHand: async (row, merge) => {
      hands.set(row.id, copy(merge(hands.get(row.id), row)));
    },
    getHand: async (id) => {
      const row = hands.get(id);
      return row === undefined ? undefined : copy(row);
    },
    listHands: async (after, limit) =>
      [...hands.values()]
        .sort((a, b) => (a.playedAt === b.playedAt ? (a.id < b.id ? 1 : -1) : a.playedAt < b.playedAt ? 1 : -1))
        .filter((r) => after === null || r.playedAt < after[0] || (r.playedAt === after[0] && r.id < after[1]))
        .slice(0, limit)
        .map(copy),
    countHands: async () => hands.size,
  };
}

// hands store (A-STO-HANDS, R0 part): rows {id, v, playedAt, mode, fav, summary, body}. The record is built by
// the engine from the views this device received (D12) — storage persists it as given and never adds data.
//
// put_rule: re-saving an id keeps the stored fav and coaching (same transaction). A record with playedAt ''
// is refused: session record-sink must stamp the device time first (S11-F09). After the first successful write
// the origin asks once for persistent storage (navigator.storage.persist — main thread only, may be refused).
// hands.list maps rows to HandListItem exactly per api.storage.v1 hand_list_mapping (AF-11).
import { summarizeRecord, upgradeRecord, type HandRecordV1 } from '@checky/engine/record';
import type { Backend, HandRow, ListCursor } from './db';
import type { HandListItem, HandStore } from './types';

const MAX_LIMIT = 50;

function toItem(row: HandRow): HandListItem {
  return {
    id: row.id,
    playedAt: row.playedAt,
    mode: row.mode,
    favorite: row.fav === 1,
    myPosition: row.summary.myPosition,
    myCards: row.summary.myCards,
    myNet: row.summary.myNet,
    botCount: row.summary.botCount,
  };
}

function encodeCursor(row: HandRow): string {
  return JSON.stringify([row.playedAt, row.id]);
}

function decodeCursor(cursor: string): ListCursor {
  try {
    const v: unknown = JSON.parse(cursor);
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  } catch {
    // fall through
  }
  throw new TypeError('invalid hands.list cursor');
}

export interface HandStoreHooks {
  /** Called once after the first successful write (persist request). */
  afterFirstWrite(): void;
}

export function createHandStore(backend: () => Promise<Backend>, hooks: HandStoreHooks): HandStore {
  let wrote = false;
  return {
    async put(rec: HandRecordV1) {
      if (typeof rec !== 'object' || rec === null || rec.v !== 1 || typeof rec.id !== 'string' || rec.id === '') {
        throw new TypeError('hands.put: not a HandRecordV1');
      }
      if (typeof rec.playedAt !== 'string' || rec.playedAt === '') throw new TypeError('hands.put: playedAt is empty');
      const row: HandRow = { id: rec.id, v: 1, playedAt: rec.playedAt, mode: rec.mode, fav: 0, summary: summarizeRecord(rec), body: rec };
      await (await backend()).putHand(row, (prev, next) =>
        prev === undefined ? next : { ...next, fav: prev.fav, body: { ...next.body, coaching: prev.body.coaching ?? next.body.coaching } },
      );
      if (!wrote) {
        wrote = true;
        hooks.afterFirstWrite();
      }
    },
    async get(id) {
      const row = await (await backend()).getHand(id);
      return row === undefined ? null : upgradeRecord(row.body);
    },
    async list(opts = {}) {
      const limit = opts.limit ?? MAX_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError('hands.list: limit must be 1..50');
      const after = opts.cursor === undefined ? null : decodeCursor(opts.cursor);
      // Read one extra row to know whether another page exists.
      const rows = await (await backend()).listHands(after, limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map(toItem), next: rows.length > limit && last !== undefined ? encodeCursor(last) : null };
    },
    async count() {
      return (await backend()).countHands();
    },
  };
}

// AC-12 (I-07): schema, nickname rule, lang/consent sync APIs, device secret + rpk, settings forbidden fields and
// defaults, hands put/get/list/count with the put_rule, fallbacks (E-STO-UNAVAILABLE / QUOTA / BLOCKED), persist,
// and zero network use. Each test gets a fresh fake-indexeddb factory and a fresh in-memory localStorage.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HandRecordV1 } from '@checky/engine/record';
import { createStorage } from './index';
import { assertNoForbiddenFields } from './settings';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

function fresh() {
  const indexedDB = new IDBFactory();
  const localStorage = new MemoryStorage();
  return { indexedDB, localStorage, storage: createStorage({ indexedDB, localStorage }) };
}

export function record(id: string, playedAt: string, over: Partial<HandRecordV1> = {}): HandRecordV1 {
  return {
    v: 1,
    id,
    handId: id,
    no: 1,
    playedAt,
    mode: 'practice',
    lang: 'en',
    appVersion: 'dev',
    table: { seatCount: 2, sb: 50, bb: 100, buttonSeat: 0, sbSeat: 0, bbSeat: 1 },
    seats: [
      { seat: 0, kind: 'me', name: 'Mina', bot: null, startStack: 10000 },
      { seat: 1, kind: 'bot', name: 'Ada', bot: { engine: 'rule', provider: null, model: null, label: 'Ada', style: 'balanced' }, startStack: 10000 },
    ],
    me: { seat: 0, holeCards: ['As', 'Kd'] },
    actions: [
      { i: 0, street: 'PREFLOP', seat: 0, type: 'post_sb', to: 50, added: 50 },
      { i: 1, street: 'PREFLOP', seat: 1, type: 'post_bb', to: 100, added: 100 },
      { i: 2, street: 'PREFLOP', seat: 0, type: 'fold', to: 50, added: 0 },
    ],
    board: [],
    showdown: [],
    pots: [{ kind: 'main', amount: 100, eligible: [1], winners: [1], shares: [100] }],
    returned: [{ seat: 1, amount: 50 }],
    endStacks: [
      { seat: 0, stack: 9950 },
      { seat: 1, stack: 10050 },
    ],
    botReveals: [],
    botChat: [],
    coaching: null,
    shared: null,
    ...over,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('schema v1', () => {
  it('creates DB checky v1 with 5 stores and 3 hand indexes', async () => {
    const { indexedDB, storage } = fresh();
    await storage.hands.count();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('checky');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(['device', 'hands', 'meta', 'profile', 'settings']);
    const tx = db.transaction(['hands', 'meta'], 'readonly');
    expect([...tx.objectStore('hands').indexNames].sort()).toEqual(['by_fav_time', 'by_mode_time', 'by_time']);
    const meta = await new Promise<unknown>((resolve) => {
      const r = tx.objectStore('meta').get('schema');
      r.onsuccess = () => resolve(r.result);
    });
    expect(meta).toMatchObject({ key: 'schema', dbVersion: 1 });
    db.close();
    expect(storage.issue()).toBeNull();
  });
});

describe('profile and lang', () => {
  it('trims and counts code points 1..16 (emoji = 1), else E-PROFILE-NICK-INVALID', async () => {
    const { storage } = fresh();
    const bad = async (nickname: string) => storage.profile.save({ nickname, avatarSeed: 1, lang: 'en' });
    await expect(bad('')).rejects.toMatchObject({ code: 'E-PROFILE-NICK-INVALID' });
    await expect(bad('    ')).rejects.toMatchObject({ code: 'E-PROFILE-NICK-INVALID' });
    await expect(bad('a'.repeat(17))).rejects.toMatchObject({ code: 'E-PROFILE-NICK-INVALID' });
    await expect(bad('😀'.repeat(17))).rejects.toMatchObject({ code: 'E-PROFILE-NICK-INVALID' });
    await storage.profile.save({ nickname: '😀'.repeat(16), avatarSeed: 1, lang: 'en' });
    await storage.profile.save({ nickname: `  ${'a'.repeat(16)}  `, avatarSeed: 7, lang: 'ja' });
    const p = await storage.profile.get();
    expect(p).toMatchObject({ nickname: 'a'.repeat(16), avatarSeed: 7, lang: 'ja' });
    expect(Number.isNaN(Date.parse(p!.updatedAt))).toBe(false);
  });

  it('profile.save also writes cp.lang.v1; lang.get/set are synchronous', async () => {
    const { storage, localStorage } = fresh();
    expect(storage.lang.get()).toBeNull();
    storage.lang.set('en');
    expect(storage.lang.get()).toBe('en');
    await storage.profile.save({ nickname: 'Mina', avatarSeed: 1, lang: 'ja' });
    expect(localStorage.getItem('cp.lang.v1')).toBe('ja');
    expect(storage.lang.get()).toBe('ja');
    localStorage.setItem('cp.lang.v1', 'xx');
    expect(storage.lang.get()).toBeNull();
    expect(() => storage.lang.set('xx' as never)).toThrow(TypeError);
  });
});

describe('consent', () => {
  it('reads cp.consent.v1 synchronously; accept and clear', () => {
    const { storage, localStorage } = fresh();
    expect(storage.consent.get()).toBeNull();
    storage.consent.accept(1);
    expect(storage.consent.get()).toMatchObject({ version: 1 });
    expect(JSON.parse(localStorage.getItem('cp.consent.v1')!)).toMatchObject({ version: 1 });
    storage.consent.clear();
    expect(storage.consent.get()).toBeNull();
    localStorage.setItem('cp.consent.v1', '{not json');
    expect(storage.consent.get()).toBeNull();
  });

  it('keeps working in memory when localStorage throws', () => {
    const throwing = new MemoryStorage();
    throwing.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    const storage = createStorage({ indexedDB: new IDBFactory(), localStorage: throwing });
    storage.consent.accept(2);
    expect(storage.consent.get()).toMatchObject({ version: 2 });
    storage.lang.set('ja');
    expect(storage.lang.get()).toBe('ja');
  });

  // R0-L2: G-01 shows gate.storageWarn from this signal, so it must be readable right after accept().
  it('a refused consent write reports E-STO-UNAVAILABLE once through issue()/onIssue(); a stored write does not', async () => {
    const throwing = new MemoryStorage();
    const refuse = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    throwing.setItem = refuse;
    throwing.removeItem = refuse;
    const storage = createStorage({ indexedDB: new IDBFactory(), localStorage: throwing });
    await storage.hands.count(); // IndexedDB itself opens fine
    const seen: unknown[] = [];
    storage.onIssue((i) => seen.push(i));
    expect(storage.issue()).toBeNull();
    storage.lang.set('ja'); // R0-L2 covers consent only
    expect(storage.issue()).toBeNull();
    storage.consent.accept(1);
    expect(storage.issue()).toBe('E-STO-UNAVAILABLE');
    storage.consent.accept(1);
    storage.consent.clear();
    expect(seen).toEqual(['E-STO-UNAVAILABLE']);
    expect(storage.consent.get()).toBeNull(); // the cleared value is kept in memory too

    const { storage: ok } = fresh();
    ok.consent.accept(1);
    expect(ok.issue()).toBeNull();
  });

  it('E-STO-UNAVAILABLE stays set: a later quota failure and recovery do not hide it', async () => {
    const throwing = new MemoryStorage();
    throwing.setItem = () => {
      throw new DOMException('denied', 'SecurityError');
    };
    const storage = createStorage({ indexedDB: new IDBFactory(), localStorage: throwing });
    await storage.hands.count();
    storage.consent.accept(1);
    const realPut = IDBObjectStore.prototype.put;
    let fail = true;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (fail && this.name === 'hands') {
        fail = false;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return realPut.apply(this, args);
    });
    await expect(storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'))).rejects.toMatchObject({ code: 'E-STO-QUOTA' });
    expect(storage.issue()).toBe('E-STO-UNAVAILABLE');
    await storage.hands.put(record('h2', '2026-11-01T10:00:01.000Z'));
    expect(storage.issue()).toBe('E-STO-UNAVAILABLE');
  });
});

describe('device secret and rpk (ADR-0016)', () => {
  it('creates 32 bytes once and returns the same value afterwards, also across instances', async () => {
    const { indexedDB, localStorage, storage } = fresh();
    const [a, b] = await Promise.all([storage.device.getSecret(), storage.device.getSecret()]);
    expect(a).toHaveLength(32);
    expect([...b]).toEqual([...a]);
    const again = createStorage({ indexedDB, localStorage });
    expect([...(await again.device.getSecret())]).toEqual([...a]);
  });

  it('rpk = b64url(SHA-256("checky/rpk/v1" || secret || code))[0..22]: deterministic, differs per room', async () => {
    const { storage } = fresh();
    const secret = await storage.device.getSecret();
    const r1 = await storage.device.roomPlayerKey('K7M2Q9XRT4');
    expect(r1).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(await storage.device.roomPlayerKey('K7M2Q9XRT4')).toBe(r1);
    expect(await storage.device.roomPlayerKey('ABCDE23456')).not.toBe(r1);
    const input = new Uint8Array([...new TextEncoder().encode('checky/rpk/v1'), ...secret, ...new TextEncoder().encode('K7M2Q9XRT4')]);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
    const b64 = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(r1).toBe(b64.slice(0, 22));
    await storage.device.regenerate();
    expect(await storage.device.roomPlayerKey('K7M2Q9XRT4')).not.toBe(r1);
  });
});

describe('settings (D-P9)', () => {
  it('first value is the AppSettings default (sound false, no localEndpoint)', async () => {
    const { storage } = fresh();
    const s = await storage.settings.get();
    expect(s).toEqual({ sound: false, liveEquityPractice: true, lastRoomSettings: null, lastPracticeBots: null, providerModels: {}, llmCap: 300 });
    expect('localEndpoint' in s).toBe(false);
  });

  it('patch merges, persists as {key:"app", values} and rejects forbidden or unknown fields with TypeError', async () => {
    const { indexedDB, localStorage, storage } = fresh();
    await expect(storage.settings.patch({ sound: true })).resolves.toMatchObject({ sound: true, llmCap: 300 });
    await expect(storage.settings.patch({ apiKey: 'x' } as never)).rejects.toBeInstanceOf(TypeError);
    await expect(storage.settings.patch({ providerModels: { openai: 'm', token: 'x' } as never })).rejects.toBeInstanceOf(TypeError);
    await expect(storage.settings.patch({ nope: 1 } as never)).rejects.toBeInstanceOf(TypeError);
    const again = createStorage({ indexedDB, localStorage });
    expect((await again.settings.get()).sound).toBe(true);
  });

  it('assertNoForbiddenFields checks everything under values, nested and in arrays', () => {
    expect(() => assertNoForbiddenFields({ a: { b: [{ secret: 1 }] } })).toThrow(TypeError);
    expect(() => assertNoForbiddenFields({ key: 'app' })).toThrow(TypeError);
    expect(() => assertNoForbiddenFields({ sound: true, providerModels: { openai: 'gpt' } })).not.toThrow();
  });
});

describe('hands (R0: put/get/list/count)', () => {
  it('refuses playedAt "" (record-sink must stamp it) and junk', async () => {
    const { storage } = fresh();
    await expect(storage.hands.put(record('h1', ''))).rejects.toBeInstanceOf(TypeError);
    await expect(storage.hands.put({ v: 2 } as never)).rejects.toBeInstanceOf(TypeError);
    expect(await storage.hands.count()).toBe(0);
  });

  it('put/get round trip, summary-based list items, newest first with an opaque cursor', async () => {
    const { storage } = fresh();
    for (let i = 0; i < 7; i += 1) await storage.hands.put(record(`h${i}`, `2026-11-01T10:00:0${i}.000Z`));
    await storage.hands.put(record('hz', '2026-11-01T10:00:03.000Z')); // same time as h3: id order breaks the tie
    expect(await storage.hands.count()).toBe(8);
    expect(await storage.hands.get('h2')).toEqual(record('h2', '2026-11-01T10:00:02.000Z'));
    expect(await storage.hands.get('missing')).toBeNull();
    const p1 = await storage.hands.list({ limit: 3 });
    expect(p1.items.map((x) => x.id)).toEqual(['h6', 'h5', 'h4']);
    expect(p1.items[0]).toEqual({ id: 'h6', playedAt: '2026-11-01T10:00:06.000Z', mode: 'practice', myPosition: 'BTN/SB', myCards: ['As', 'Kd'], myNet: -50, favorite: false, botCount: 1 });
    const p2 = await storage.hands.list({ limit: 3, cursor: p1.next! });
    expect(p2.items.map((x) => x.id)).toEqual(['hz', 'h3', 'h2']);
    const p3 = await storage.hands.list({ limit: 3, cursor: p2.next! });
    expect(p3.items.map((x) => x.id)).toEqual(['h1', 'h0']);
    expect(p3.next).toBeNull();
    await expect(storage.hands.list({ limit: 51 })).rejects.toBeInstanceOf(RangeError);
    await expect(storage.hands.list({ cursor: 'garbage' })).rejects.toBeInstanceOf(TypeError);
  });

  it('re-saving the same id keeps the stored fav and coaching (put_rule)', async () => {
    const { indexedDB, storage } = fresh();
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    // Simulate 4-1 setting fav/coaching on the row.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('checky');
      r.onsuccess = () => resolve(r.result);
    });
    const coaching = { lang: 'en' as const, provider: 'openai' as const, model: 'm', createdAt: 'x', items: [] };
    await new Promise<void>((resolve) => {
      const tx = db.transaction('hands', 'readwrite');
      const st = tx.objectStore('hands');
      const g = st.get('h1');
      g.onsuccess = () => {
        const row = g.result as { fav: number; body: HandRecordV1 };
        st.put({ ...row, fav: 1, body: { ...row.body, coaching } });
      };
      tx.oncomplete = () => resolve();
    });
    db.close();
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    expect((await storage.hands.get('h1'))!.coaching).toEqual(coaching);
    expect((await storage.hands.list()).items[0]!.favorite).toBe(true);
  });

  it('asks navigator.storage.persist() once after the first write, and skips when it does not exist', async () => {
    const persist = vi.fn(() => Promise.resolve(true));
    vi.stubGlobal('navigator', { ...navigator, storage: { persist } });
    const { storage } = fresh();
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    await storage.hands.put(record('h2', '2026-11-01T10:00:01.000Z'));
    expect(persist).toHaveBeenCalledTimes(1);
    vi.stubGlobal('navigator', { ...navigator, storage: undefined });
    await expect(fresh().storage.hands.put(record('h3', '2026-11-01T10:00:02.000Z'))).resolves.toBeUndefined();
  });
});

describe('failures never stop the game', () => {
  it('IndexedDB open failure -> memory backend + E-STO-UNAVAILABLE, APIs keep working', async () => {
    const broken = { open: () => { throw new DOMException('denied', 'SecurityError'); } } as unknown as IDBFactory;
    const seen: unknown[] = [];
    const storage = createStorage({ indexedDB: broken, localStorage: new MemoryStorage() });
    storage.onIssue((i) => seen.push(i));
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    expect(storage.issue()).toBe('E-STO-UNAVAILABLE');
    expect(await storage.hands.count()).toBe(1);
    await storage.profile.save({ nickname: 'Mina', avatarSeed: 1, lang: 'en' });
    expect((await storage.profile.get())?.nickname).toBe('Mina');
    expect((await storage.device.getSecret()).length).toBe(32);
    expect(seen).toEqual(['E-STO-UNAVAILABLE']); // the open fails asynchronously, so a listener added at boot sees it
    const none = createStorage({ indexedDB: undefined, localStorage: new MemoryStorage() });
    expect(none.issue()).toBe('E-STO-UNAVAILABLE');
  });

  it('quota exceeded on a hand write -> that record fails with E-STO-QUOTA, later writes still work', async () => {
    const { storage } = fresh();
    await storage.hands.count();
    const realPut = IDBObjectStore.prototype.put;
    let fail = true;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (fail && this.name === 'hands') {
        fail = false;
        throw new DOMException('full', 'QuotaExceededError');
      }
      return realPut.apply(this, args);
    });
    await expect(storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'))).rejects.toMatchObject({ code: 'E-STO-QUOTA' });
    expect(storage.issue()).toBe('E-STO-QUOTA');
    await storage.hands.put(record('h2', '2026-11-01T10:00:01.000Z'));
    expect(storage.issue()).toBeNull();
    expect(await storage.hands.count()).toBe(1);
  });

  it('a version change from another tab closes this connection and reports E-STO-BLOCKED', async () => {
    const { indexedDB, storage } = fresh();
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    await new Promise<void>((resolve) => {
      const r = indexedDB.open('checky', 2);
      r.onupgradeneeded = () => undefined;
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
    expect(storage.issue()).toBe('E-STO-BLOCKED');
    await expect(storage.hands.put(record('h2', '2026-11-01T10:00:01.000Z'))).resolves.toBeUndefined();
  });
});

describe('no network', () => {
  it('profile save, settings and hands.list make zero fetch/WebSocket/RTCPeerConnection calls', async () => {
    const fetchSpy = vi.fn();
    const wsSpy = vi.fn();
    const rtcSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('RTCPeerConnection', rtcSpy);
    const { storage } = fresh();
    await storage.profile.save({ nickname: 'Mina', avatarSeed: 1, lang: 'en' });
    await storage.settings.patch({ sound: true });
    await storage.hands.put(record('h1', '2026-11-01T10:00:00.000Z'));
    await storage.hands.list();
    await storage.device.roomPlayerKey('K7M2Q9XRT4');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(rtcSpy).not.toHaveBeenCalled();
  });
});

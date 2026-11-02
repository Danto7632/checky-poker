// IndexedDB schema steps (storage.idb.v1, data-model section 10). MIGRATIONS[i] upgrades version i -> i + 1 and
// runs inside onupgradeneeded, so a browser on any old version climbs one step at a time. Steps only ADD stores
// and indexes; deletions wait for the next major (export files keep old data readable).
export const DB_NAME = 'checky';
export const DB_VERSION = 1;

type Step = (db: IDBDatabase, tx: IDBTransaction) => void;

export const MIGRATIONS: readonly Step[] = [
  // 0 -> 1: the five stores and three hand indexes. fav is 0|1 because booleans are not valid IndexedDB keys.
  (db, tx) => {
    db.createObjectStore('meta', { keyPath: 'key' });
    db.createObjectStore('device', { keyPath: 'key' });
    db.createObjectStore('profile', { keyPath: 'key' });
    db.createObjectStore('settings', { keyPath: 'key' });
    const hands = db.createObjectStore('hands', { keyPath: 'id' });
    hands.createIndex('by_time', 'playedAt');
    hands.createIndex('by_mode_time', ['mode', 'playedAt']);
    hands.createIndex('by_fav_time', ['fav', 'playedAt']);
    tx.objectStore('meta').put({ key: 'schema', dbVersion: 1, createdAt: new Date().toISOString() });
  },
];

export function runMigrations(db: IDBDatabase, tx: IDBTransaction, oldVersion: number, newVersion: number): void {
  for (let v = oldVersion; v < newVersion; v += 1) {
    const step = MIGRATIONS[v];
    if (step === undefined) throw new RangeError(`no migration from version ${v}`);
    step(db, tx);
  }
}

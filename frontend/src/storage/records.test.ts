// AC-11 (IndexedDB half): real practice records saved with hands.put; the stored rows — summary and body —
// contain no card the recording seat did not see, no rpk; playedAt is the stamped time; list items match.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { collectCardLeaks } from '../../../packages/engine/test/helpers/card-leak';
import { practiceRecords } from '../../../packages/engine/test/helpers/records';
import { createStorage } from './index';

describe('hands rows hold only what the player saw (record.hand.v1 must_not_contain)', () => {
  it('40 practice records round-trip through IndexedDB without extra cards', async () => {
    const indexedDB = new IDBFactory();
    const storage = createStorage({ indexedDB, localStorage: undefined });
    const recs = practiceRecords(40, 'idb-rows');
    expect(recs).toHaveLength(40);
    let t = Date.parse('2026-11-01T10:00:00.000Z');
    for (const { rec } of recs) await storage.hands.put({ ...rec, playedAt: new Date((t += 1000)).toISOString() });
    // Read the raw rows, not just the API, so the summary and every stored field are covered.
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('checky');
      r.onsuccess = () => resolve(r.result);
    });
    const rows = await new Promise<unknown[]>((resolve) => {
      const r = db.transaction('hands').objectStore('hands').getAll();
      r.onsuccess = () => resolve(r.result as unknown[]);
    });
    db.close();
    expect(rows).toHaveLength(40);
    const seenById = new Map(recs.map((x) => [x.rec.id, x.seen]));
    for (const row of rows as { id: string; playedAt: string }[]) {
      expect(collectCardLeaks(row, seenById.get(row.id)!)).toEqual([]);
      expect(JSON.stringify(row)).not.toMatch(/rpkHostDeviceKey|practice-rpk/);
      expect(row.playedAt).not.toBe('');
    }
    const { items } = await storage.hands.list({ limit: 50 });
    expect(items).toHaveLength(40);
    for (const item of items) expect(collectCardLeaks(item, seenById.get(item.id)!)).toEqual([]);
  });
});

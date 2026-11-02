// ADR-0007: applyEnvelope keeps the newest snapshot under reordering, duplication and loss; getSnapshot keeps
// its reference until something changes; chat/notice windows; alerts clear when the next hand starts.
import { describe, expect, it, vi } from 'vitest';
import { envelope, type Envelope, type PlayerView } from '@checky/engine/protocol';
import { createFakeClient } from './fake';
import { createClientStore, initialSnapshot } from './client-store';
import { createRecordSink } from './record-sink';
import { defaults } from '@/config';
import type { HandRecordV1 } from '@checky/engine/record';
import type { AppConfig } from './types';

const viewA = createFakeClient('my-turn').getSnapshot().view!;
const viewB = createFakeClient('showdown').getSnapshot().view!;
const viewOf = (no: number, handId = viewA.hand!.handId): PlayerView => ({ ...viewA, hand: { ...viewA.hand!, no, handId } }) as PlayerView;

describe('applyEnvelope ordering', () => {
  it.each([
    ['in order', [1, 2, 3, 4, 5]],
    ['reversed', [5, 4, 3, 2, 1]],
    ['duplicated', [1, 2, 2, 3, 5, 5, 4]],
    ['with gaps (lost 2 and 4)', [1, 3, 5]],
    ['shuffled', [3, 1, 5, 2, 4]],
  ])('%s -> the state is the highest-s snapshot that arrived in order', (_n, order) => {
    const store = createClientStore(initialSnapshot('ready'), () => 0);
    let best = 0;
    for (const s of order) {
      store.applyEnvelope(envelope('H.VIEW', s, { view: viewOf(s) }) as Envelope);
      best = Math.max(best, s);
      expect(store.getSnapshot().view?.hand?.no).toBe(best);
    }
  });

  it('getSnapshot returns the same reference until a change; dropped envelopes do not notify', () => {
    const store = createClientStore(initialSnapshot('ready'), () => 0);
    const listener = vi.fn();
    store.subscribe(listener);
    const s0 = store.getSnapshot();
    expect(store.getSnapshot()).toBe(s0);
    expect(store.applyEnvelope(envelope('H.VIEW', 2, { view: viewA }) as Envelope)).toBe(true);
    const s1 = store.getSnapshot();
    expect(s1).not.toBe(s0);
    expect(store.applyEnvelope(envelope('H.VIEW', 1, { view: viewB }) as Envelope)).toBe(false);
    expect(store.getSnapshot()).toBe(s1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps the last 100 chat lines and 20 notices; H.CLOSED sets closed and stage', () => {
    const store = createClientStore(initialSnapshot('ready'), () => 42);
    const line = createFakeClient('my-turn').getSnapshot().chat[0]!;
    let s = 0;
    for (let i = 0; i < 130; i += 1) store.applyEnvelope(envelope('H.CHAT', ++s, { line: { ...line, id: `c${i}` } }) as Envelope);
    for (let i = 0; i < 30; i += 1) store.applyEnvelope(envelope('H.NOTICE', ++s, { code: 'N-PAUSED', p: {} }) as Envelope);
    expect(store.getSnapshot().chat).toHaveLength(100);
    expect(store.getSnapshot().chat[0]!.id).toBe('c30');
    expect(store.getSnapshot().notices).toHaveLength(20);
    expect(store.getSnapshot().notices[0]!.atMs).toBe(42);
    const summary = createFakeClient('closed').getSnapshot().closed!;
    store.applyEnvelope(envelope('H.CLOSED', ++s, { summary }) as Envelope);
    expect(store.getSnapshot()).toMatchObject({ closed: summary, conn: { stage: 'closed' } });
  });

  it('an alert stays for the voided hand and clears when the next hand starts', () => {
    const store = createClientStore(initialSnapshot('ready'), () => 0);
    store.applyEnvelope(envelope('H.VIEW', 1, { view: viewOf(1, 'handAAAAAAAAAAAAAAAAAA') }) as Envelope);
    store.patch((x) => ({ ...x, alert: { code: 'E-ENG-INVARIANT', atMs: 1 } }));
    store.applyEnvelope(envelope('H.VIEW', 2, { view: viewOf(1, 'handAAAAAAAAAAAAAAAAAA') }) as Envelope);
    expect(store.getSnapshot().alert).not.toBeNull();
    store.applyEnvelope(envelope('H.VIEW', 3, { view: viewOf(2, 'handBBBBBBBBBBBBBBBBBB') }) as Envelope);
    expect(store.getSnapshot().alert).toBeNull();
  });
});

describe('record-sink (D-P7)', () => {
  const config = (): AppConfig => ({ defaults, APP_VERSION: 'test-sha', debugLog: vi.fn(), getE2EHooks: () => null });

  it('stamps playedAt with the device ISO time right before hands.put, once per finished hand', async () => {
    const put = vi.fn((_rec: HandRecordV1) => Promise.resolve());
    const cfg = config();
    const sink = createRecordSink({ mode: 'friend', hands: { put, get: vi.fn(), list: vi.fn(), count: vi.fn() }, config: cfg, nowIso: () => '2026-11-01T12:00:00.000Z' });
    const done = createFakeClient('showdown').getSnapshot().view!;
    sink.onView(done);
    sink.onView(done);
    await sink.flush();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]![0]).toMatchObject({ playedAt: '2026-11-01T12:00:00.000Z', mode: 'friend', appVersion: 'test-sha', no: 7 });
  });

  it('a failed save is logged and never throws into the game', async () => {
    const cfg = config();
    const put = vi.fn((_rec: HandRecordV1) => Promise.reject(Object.assign(new Error('E-STO-QUOTA'), { code: 'E-STO-QUOTA' })));
    const sink = createRecordSink({ mode: 'practice', hands: { put, get: vi.fn(), list: vi.fn(), count: vi.fn() }, config: cfg });
    sink.onView(createFakeClient('showdown').getSnapshot().view!);
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(cfg.debugLog).toHaveBeenCalledWith('E-STO-QUOTA');
  });
});

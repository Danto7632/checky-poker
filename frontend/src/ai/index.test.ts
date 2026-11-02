// Public @/ai surface: prewarmMetrics (lead review 2 R0-L12; Promise<boolean> readiness, lead review 4 R0-L35) and
// computeMetricsAsync sharing the tab's one metrics Worker. The real spawnWorker wiring runs against a stubbed
// global Worker; every case imports a fresh module graph because the shared client is module state.
import type { DecisionMetrics, MetricsView } from '@checky/analysis';
import { afterEach, describe, expect, it, vi } from 'vitest';

const VIEW: MetricsView = {
  me: { seat: 0, holeCards: ['As', 'Kd'], legal: { call: null } },
  seats: [
    { seat: 0, occupant: { isMe: true, stack: 9900, inHand: { bet: 100, folded: false, position: 'BB' } } },
    { seat: 1, occupant: { isMe: false, stack: 9900, inHand: { bet: 100, folded: false, position: 'BTN/SB' } } },
  ],
  hand: { street: 'PREFLOP', board: [], buttonSeat: 1, startStacks: [{ seat: 0, stack: 10000 }, { seat: 1, stack: 10000 }], actions: [] },
};

const METRICS: DecisionMetrics = {
  equity: { value: 0.66, method: 'mc', samples: 10_000, halfWidth95: 0.0093, opponents: 1 },
  potOdds: null,
  requiredEquity: null,
  effectiveStack: 9900,
  spr: null,
  position: { label: 'BB', inPosition: null },
  verdict: null,
  basis: 'vs_random_hands',
};

/**
 * Replaces the global Worker. The first `throwing` constructions throw (as `new Worker` does when the platform
 * refuses it); `attempts` counts every construction, `made` keeps the ones that succeeded.
 */
function stubWorker(throwing = 0) {
  const made: FakeWorker[] = [];
  let attempts = 0;
  class FakeWorker {
    onmessage: ((e: MessageEvent<unknown>) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onmessageerror: ((e: MessageEvent<unknown>) => void) | null = null;
    readonly posted: unknown[] = [];
    terminated = false;
    constructor() {
      attempts += 1;
      if (attempts <= throwing) throw new DOMException('Worker refused', 'SecurityError');
      made.push(this);
    }
    postMessage(msg: unknown): void {
      this.posted.push(msg);
    }
    terminate(): void {
      this.terminated = true;
    }
    reply(data: unknown): void {
      this.onmessage?.(new MessageEvent('message', { data }));
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return { made, attempts: () => attempts };
}

// Settled value or 'pending' (the promises under test are resolved directly, so race() sees them first).
const state = <T>(p: Promise<T>): Promise<T | 'pending'> => Promise.race([p, Promise.resolve('pending' as const)]);

async function freshAi() {
  vi.resetModules();
  return import('./index');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('prewarmMetrics (lead review 2 R0-L12)', () => {
  it('spawns the shared Worker once however often it is called, and computeMetricsAsync reuses that Worker', async () => {
    const w = stubWorker();
    const ai = await freshAi();
    expect(w.attempts()).toBe(0); // importing spawns nothing (the gate keeps @/ai out of the pre-gate bundle anyway)
    const warm = ai.prewarmMetrics();
    expect(ai.prewarmMetrics()).toBe(warm);
    expect(ai.prewarmMetrics()).toBe(warm);
    expect(w.made).toHaveLength(1);
    // Spawned is not ready: nothing has come back from the Worker yet (R0-L35).
    await expect(state(warm)).resolves.toBe('pending');
    const p = ai.computeMetricsAsync(VIEW, 'display');
    expect(w.attempts()).toBe(1);
    expect(w.made[0]!.posted).toEqual([{ reqId: 1, kind: 'view', view: VIEW, precision: 'display' }]);
    // The Worker's ready message lands while that compute is pending: it settles prewarm only.
    w.made[0]!.reply({ kind: 'ready' });
    await expect(state(warm)).resolves.toBe(true);
    await expect(state(p)).resolves.toBe('pending');
    w.made[0]!.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(p).resolves.toEqual(METRICS);
    expect(ai.prewarmMetrics()).toBe(warm); // a later table's PR-01 mount: still the same Worker and promise
    expect(w.attempts()).toBe(1);
  });

  it('a spawn that throws keeps no broken client: prewarm stays silent, compute rejects instead of throwing, the next call retries', async () => {
    const w = stubWorker(2);
    const ai = await freshAi();
    let warm: Promise<boolean> | undefined;
    expect(() => {
      warm = ai.prewarmMetrics();
    }).not.toThrow();
    await expect(state(warm!)).resolves.toBe(false); // resolves, never rejects (R0-L35)
    expect(w.attempts()).toBe(1);
    // Still refused: a rejected promise (LiveOdds hides the panel), never a synchronous throw out of its effect.
    let refused: Promise<DecisionMetrics> | undefined;
    expect(() => {
      refused = ai.computeMetricsAsync(VIEW, 'display');
    }).not.toThrow();
    await expect(refused).rejects.toThrow('metrics worker failed');
    expect(w.attempts()).toBe(2);
    // The platform accepts the third spawn: the client is not stuck on the earlier failures.
    const p = ai.computeMetricsAsync(VIEW, 'display');
    expect(w.attempts()).toBe(3);
    expect(w.made).toHaveLength(1);
    // A refused call never posted, so it took no request id.
    expect(w.made[0]!.posted).toEqual([{ reqId: 1, kind: 'view', view: VIEW, precision: 'display' }]);
    w.made[0]!.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(p).resolves.toEqual(METRICS);
  });

  it('a prewarmed Worker that fails (its script did not load) is dropped and the next compute spawns a new one', async () => {
    const w = stubWorker();
    const ai = await freshAi();
    const first = ai.prewarmMetrics();
    const dead = w.made[0]!;
    dead.onerror?.(new Event('error'));
    await expect(state(first)).resolves.toBe(false); // failed before any message (R0-L35)
    expect(dead.terminated).toBe(true);
    const p = ai.computeMetricsAsync(VIEW, 'display');
    expect(w.made).toHaveLength(2);
    const live = w.made[1]!;
    expect(live.posted).toHaveLength(1);
    // A late event from the dropped Worker must not tear down its successor or settle the new request.
    dead.onmessageerror?.(new MessageEvent('messageerror'));
    dead.onerror?.(new Event('error'));
    dead.reply({ kind: 'ready' });
    expect(live.terminated).toBe(false);
    const second = ai.prewarmMetrics();
    expect(second).not.toBe(first);
    await expect(state(second)).resolves.toBe('pending'); // nothing from the dead Worker counts for its successor
    live.reply({ reqId: 1, ok: true, metrics: METRICS }); // a reply is a first message too: the Worker runs
    await expect(state(p)).resolves.toEqual(METRICS);
    await expect(state(second)).resolves.toBe(true);
    expect(w.made).toHaveLength(2);
  });
});

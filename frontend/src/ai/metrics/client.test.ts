// AC-10: metrics client over a fake Worker port (request, reply, supersede, bad reply, E-ANL-SLOW, failure,
// readiness for prewarmMetrics) and the Worker itself: its pure handler (shape check of the incoming view, error
// replies) and its entry (the ready message, lead review 4 R0-L35).
import type { DecisionMetrics, MetricsView } from '@checky/analysis';
import { createSeededRng } from '@checky/engine/util';
import { getDebugLog } from '@/config';
import { describe, expect, it, vi } from 'vitest';
import { createMetricsClient, isDecisionMetrics, type MetricsPort } from './client';
import { handle, METRICS_READY, readMetricsView, type MetricsRequest } from './metrics.worker';

// Heads-up flop, me (seat 0, BTN/SB) facing a 200 bet from seat 1.
const VIEW: MetricsView = {
  me: { seat: 0, holeCards: ['As', 'Kd'], legal: { call: { amount: 200, to: 200 } } },
  seats: [
    { seat: 0, occupant: { isMe: true, stack: 9900, inHand: { bet: 0, folded: false, position: 'BTN/SB' } } },
    { seat: 1, occupant: { isMe: false, stack: 9700, inHand: { bet: 200, folded: false, position: 'BB' } } },
  ],
  hand: {
    street: 'FLOP',
    board: ['2c', '7d', 'Jh'],
    buttonSeat: 0,
    startStacks: [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 10000 },
    ],
    actions: [
      { street: 'PREFLOP', seat: 0, type: 'post_sb', added: 50 },
      { street: 'PREFLOP', seat: 1, type: 'post_bb', added: 100 },
      { street: 'PREFLOP', seat: 0, type: 'call', added: 50 },
      { street: 'PREFLOP', seat: 1, type: 'check', added: 0 },
      { street: 'FLOP', seat: 1, type: 'bet', added: 200 },
    ],
  },
};

const METRICS: DecisionMetrics = {
  equity: { value: 0.6, method: 'exact', samples: null, halfWidth95: null, opponents: 1 },
  potOdds: { pot: 400, call: 200 },
  requiredEquity: 1 / 3,
  effectiveStack: 9900,
  spr: 49.5,
  position: { label: 'BTN/SB', inPosition: true },
  verdict: 'call_ok',
  basis: 'vs_random_hands',
};

function fakePort() {
  const sent: MetricsRequest[] = [];
  let onData: (d: unknown) => void = () => undefined;
  let onFail: () => void = () => undefined;
  let terminated = 0;
  const port: MetricsPort = {
    post: (m) => sent.push(m),
    listen: (d, f) => {
      onData = d;
      onFail = f;
    },
    terminate: () => {
      terminated += 1;
    },
  };
  return { port, sent, reply: (d: unknown) => onData(d), fail: () => onFail(), terminated: () => terminated };
}

const slowEntries = () => getDebugLog().filter((e) => e.code === 'E-ANL-SLOW');

// Settled value of a promise, or 'pending'. Only valid for promises resolved directly (no thenable chain), which
// holds for warm() and compute(): race() then sees an already-settled promise before the sentinel.
const PENDING = 'pending' as const;
const state = <T>(p: Promise<T>): Promise<T | typeof PENDING> => Promise.race([p, Promise.resolve(PENDING)]);

describe('createMetricsClient', () => {
  it('posts {reqId, kind:view, view, precision} and resolves with the reply', async () => {
    const f = fakePort();
    const c = createMetricsClient(() => f.port);
    const p = c.compute(VIEW, 'display');
    expect(f.sent).toEqual([{ reqId: 1, kind: 'view', view: VIEW, precision: 'display' }]);
    f.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(p).resolves.toEqual(METRICS);
  });

  it('only the latest request counts: the older one rejects with AbortError and its reply is ignored', async () => {
    const f = fakePort();
    const c = createMetricsClient(() => f.port);
    const first = c.compute(VIEW, 'display');
    const second = c.compute(VIEW, 'display');
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    f.reply({ reqId: 1, ok: true, metrics: { ...METRICS, effectiveStack: 1 } });
    f.reply({ reqId: 2, ok: true, metrics: METRICS });
    await expect(second).resolves.toEqual(METRICS);
  });

  it('unreadable and stale replies are ignored; an ok:false reply rejects', async () => {
    const f = fakePort();
    const c = createMetricsClient(() => f.port);
    const p = c.compute(VIEW, 'bot');
    f.reply('garbage');
    f.reply({ reqId: '1', ok: true, metrics: METRICS });
    f.reply({ reqId: 0, ok: true, metrics: METRICS });
    f.reply({ reqId: 1, ok: false });
    await expect(p).rejects.toThrow('rejected by the worker');
  });

  // Lead review R0 3.2 m2: a reply that names the current request but carries a bad body used to be dropped, which
  // left LiveOdds "calculating" until the next view. The race makes the old behaviour fail at once, not by timeout.
  it.each([
    ['metrics that fail the shape check', { reqId: 1, ok: true, metrics: { ...METRICS, basis: 'gto' } }],
    ['no metrics', { reqId: 1, ok: true }],
    ['an ok flag that is neither true nor false', { reqId: 1, ok: 'yes', metrics: METRICS }],
  ])('a reply for the current request with %s rejects (metrics reply malformed)', async (_, body) => {
    const f = fakePort();
    const c = createMetricsClient(() => f.port);
    const p = c.compute(VIEW, 'display');
    f.reply(body);
    await expect(Promise.race([p, Promise.resolve('still pending')])).rejects.toThrow('metrics reply malformed');
    // The request is settled: a later well-formed reply with the same id changes nothing.
    f.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(p).rejects.toThrow('metrics reply malformed');
  });

  it('logs E-ANL-SLOW {ms} only when the reply takes longer than 500 ms', async () => {
    let t = 0;
    const f = fakePort();
    const c = createMetricsClient(() => f.port, () => t);
    const before = slowEntries().length;

    const fast = c.compute(VIEW, 'display');
    t = 499;
    f.reply({ reqId: 1, ok: true, metrics: METRICS });
    await fast;
    expect(slowEntries()).toHaveLength(before);

    const slow = c.compute(VIEW, 'display');
    t = 499 + 612.4;
    f.reply({ reqId: 2, ok: true, metrics: METRICS });
    await slow;
    expect(slowEntries().slice(before)).toEqual([expect.objectContaining({ code: 'E-ANL-SLOW', data: { ms: 612 } })]);
  });

  it('a Worker failure rejects the pending request and the next call respawns', async () => {
    const ports = [fakePort(), fakePort()];
    let spawned = 0;
    const c = createMetricsClient(() => ports[spawned++]!.port);
    const p = c.compute(VIEW, 'display');
    ports[0]!.fail();
    await expect(p).rejects.toThrow('metrics worker failed');
    expect(ports[0]!.terminated()).toBe(1);
    const q = c.compute(VIEW, 'display');
    expect(spawned).toBe(2);
    ports[1]!.reply({ reqId: 2, ok: true, metrics: METRICS });
    await expect(q).resolves.toEqual(METRICS);
  });
});

// Lead review 4 R0-L35: the PR-01 offline line waits for warm() === true, so "true" must mean the Worker answered,
// not that it was constructed (the gap the Andrew fix3 review measured at ~400 ms RTT).
describe('createMetricsClient warm() (prewarmMetrics readiness, lead review 4 R0-L35)', () => {
  it('stays pending until the Worker\'s first message, then resolves true; posts nothing and takes no reqId', async () => {
    const f = fakePort();
    let spawned = 0;
    const c = createMetricsClient(() => {
      spawned += 1;
      return f.port;
    });
    const w = c.warm();
    expect(spawned).toBe(1);
    await expect(state(w)).resolves.toBe(PENDING);
    expect(f.sent).toEqual([]);
    f.reply(METRICS_READY);
    await expect(state(w)).resolves.toBe(true);
    // Idempotent while this Worker lives: the same promise, no new spawn.
    expect(c.warm()).toBe(w);
    expect(spawned).toBe(1);
    // The probe used no request id: the first compute is still reqId 1.
    const p = c.compute(VIEW, 'display');
    expect(f.sent).toEqual([{ reqId: 1, kind: 'view', view: VIEW, precision: 'display' }]);
    f.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(p).resolves.toEqual(METRICS);
  });

  it('resolves false (never rejects) when the spawn throws, and the next call spawns again', async () => {
    const f = fakePort();
    let attempts = 0;
    const c = createMetricsClient(() => {
      attempts += 1;
      if (attempts === 1) throw new DOMException('Worker refused', 'SecurityError');
      return f.port;
    });
    await expect(state(c.warm())).resolves.toBe(false);
    const w = c.warm();
    expect(attempts).toBe(2);
    await expect(state(w)).resolves.toBe(PENDING);
    f.reply(METRICS_READY);
    await expect(w).resolves.toBe(true);
  });

  it('resolves false when the Worker fails before its first message; the next call spawns and returns a new promise that only its own Worker settles', async () => {
    const ports = [fakePort(), fakePort(), fakePort()];
    let spawned = 0;
    const c = createMetricsClient(() => ports[spawned++]!.port);
    const first = c.warm();
    expect(c.warm()).toBe(first);
    ports[0]!.fail(); // e.g. the script fetch was aborted (net::ERR_ABORTED in the fix3 review)
    await expect(state(first)).resolves.toBe(false);
    expect(ports[0]!.terminated()).toBe(1);
    const second = c.warm();
    expect(second).not.toBe(first);
    expect(spawned).toBe(2);
    // Late events of the dropped Worker settle nothing of its successor.
    ports[0]!.reply(METRICS_READY);
    ports[0]!.fail();
    await expect(state(second)).resolves.toBe(PENDING);
    expect(ports[1]!.terminated()).toBe(0);
    ports[1]!.reply(METRICS_READY);
    await expect(state(second)).resolves.toBe(true);
    // A later failure cannot turn a settled true into false; it drops the Worker and the next call starts over.
    ports[1]!.fail();
    await expect(second).resolves.toBe(true);
    const third = c.warm();
    expect(spawned).toBe(3);
    await expect(state(third)).resolves.toBe(PENDING);
  });

  it('a ready message that overlaps a pending compute neither settles it nor changes its result', async () => {
    const f = fakePort();
    const c = createMetricsClient(() => f.port);
    // Real order on a cold tab: warm() spawns, a table computes before the ready message has arrived.
    const w = c.warm();
    const p = c.compute(VIEW, 'display');
    expect(c.warm()).toBe(w);
    f.reply(METRICS_READY);
    await expect(state(w)).resolves.toBe(true);
    await expect(state(p)).resolves.toBe(PENDING);
    f.reply({ reqId: 1, ok: true, metrics: METRICS });
    await expect(state(p)).resolves.toEqual(METRICS);
    // And the next request is unaffected too: reqId 2, its own reply.
    const q = c.compute(VIEW, 'bot');
    expect(f.sent.map((m) => m.reqId)).toEqual([1, 2]);
    f.reply(METRICS_READY); // a stray repeat is just as inert
    await expect(state(q)).resolves.toBe(PENDING);
    f.reply({ reqId: 2, ok: true, metrics: { ...METRICS, effectiveStack: 42 } });
    await expect(state(q)).resolves.toEqual({ ...METRICS, effectiveStack: 42 });
  });
});

describe('metrics worker handler', () => {
  const rng = createSeededRng('worker-test');

  it('answers a view request with computeMetrics output', () => {
    const reply = handle({ reqId: 7, kind: 'view', view: structuredClone(VIEW), precision: 'display' }, rng);
    expect(reply).toMatchObject({ reqId: 7, ok: true });
    expect(reply?.ok === true && isDecisionMetrics(reply.metrics)).toBe(true);
    expect(reply?.ok === true && reply.metrics.potOdds).toEqual({ pot: 400, call: 200 });
  });

  it('rejects malformed requests without throwing', () => {
    expect(handle('nope', rng)).toBeNull();
    expect(handle({ reqId: 1.5, kind: 'view' }, rng)).toBeNull();
    expect(handle({ reqId: 2, kind: 'record', view: VIEW, precision: 'display' }, rng)).toEqual({ reqId: 2, ok: false });
    expect(handle({ reqId: 3, kind: 'view', view: VIEW, precision: 'max' }, rng)).toEqual({ reqId: 3, ok: false });
    const badCard = structuredClone(VIEW) as unknown as { me: { holeCards: string[] } };
    badCard.me.holeCards = ['As', 'XX'];
    expect(handle({ reqId: 4, kind: 'view', view: badCard, precision: 'display' }, rng)).toEqual({ reqId: 4, ok: false });
    // A precondition failure inside computeMetrics (no hole cards) becomes ok:false, not a crashed Worker.
    const noCards = { ...VIEW, me: { ...VIEW.me, holeCards: null } };
    expect(handle({ reqId: 5, kind: 'view', view: noCards, precision: 'display' }, rng)).toEqual({ reqId: 5, ok: false });
  });

  it('a slow exact display reply quarters the exact budget so the next one goes Monte Carlo (D-S7)', () => {
    const river: MetricsView = { ...VIEW, hand: { ...VIEW.hand!, street: 'RIVER', board: ['2c', '7d', 'Jh', '4s', '9h'] } };
    const budget = { exactLimit: 1000 }; // river N=1 costs 991 units: exact under 1000, Monte Carlo under 250
    const clock = (...ticks: number[]) => () => ticks.shift() ?? 0;
    const fast = handle({ reqId: 1, kind: 'view', view: river, precision: 'display' }, rng, budget, clock(0, 20));
    expect(fast?.ok === true && fast.metrics.equity.method).toBe('exact');
    expect(budget.exactLimit).toBe(1000);
    const slow = handle({ reqId: 2, kind: 'view', view: river, precision: 'display' }, rng, budget, clock(0, 612));
    expect(slow?.ok === true && slow.metrics.equity.method).toBe('exact');
    expect(budget.exactLimit).toBe(250);
    const next = handle({ reqId: 3, kind: 'view', view: river, precision: 'display' }, rng, budget, clock(0, 40));
    expect(next?.ok === true && next.metrics.equity).toMatchObject({ method: 'mc', samples: 10_000 });
  });

  it('readMetricsView keeps only the fields computeMetrics reads', () => {
    const withExtras = { ...structuredClone(VIEW), result: { secret: true }, room: { kind: 'practice' } };
    expect(readMetricsView(withExtras)).toEqual(VIEW);
  });
});

// The entry only wires itself where there is no `document` (inside a real Worker). Here a fresh module instance is
// loaded with `document` removed and `self` replaced by a fake Worker scope.
describe('metrics worker entry (lead review 4 R0-L35)', () => {
  it('posts exactly one ready message, without a reqId, after onmessage is wired; requests are answered after it', async () => {
    const posted: unknown[] = [];
    const wiredWhenPosted: boolean[] = [];
    const scope: { onmessage: ((e: { data: unknown }) => void) | null; postMessage(m: unknown): void } = {
      onmessage: null,
      postMessage(m) {
        posted.push(m);
        wiredWhenPosted.push(scope.onmessage !== null);
      },
    };
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('self', scope);
    try {
      vi.resetModules();
      await import('./metrics.worker');
      expect(posted).toEqual([{ kind: 'ready' }]);
      expect(wiredWhenPosted).toEqual([true]);
      scope.onmessage?.({ data: { reqId: 1, kind: 'view', view: structuredClone(VIEW), precision: 'display' } });
      expect(posted).toHaveLength(2);
      expect(posted[1]).toMatchObject({ reqId: 1, ok: true });
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});

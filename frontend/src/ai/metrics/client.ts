// computeMetricsAsync (A-AI-METRICS-ASYNC, I-08): main-thread client of the metrics Worker.
//
// - One Worker per tab, shared by every table. prewarmMetrics() spawns it ahead of use (PR-01 calls it while the
//   page is online, lead review 2 R0-L12), so LiveOdds works on a table first opened offline; otherwise the first
//   compute spawns it. A spawn that throws leaves no port behind, and a Worker that fails (error / messageerror,
//   e.g. its script did not load) is dropped; either way the next call spawns again.
// - prewarmMetrics() resolves true on that Worker's first message (the ready message the Worker posts once its
//   script runs, lead review 4 R0-L35) and false if the spawn throws or the Worker fails first; the PR-01 offline
//   line waits for true. The ready message has no reqId, so it never touches the pending compute.
// - compute() never throws: a spawn failure comes back as a rejected promise, because LiveOdds calls it in an effect.
// - Only the latest request counts: a new request rejects the previous promise with AbortError and that
//   request's reply is ignored when it arrives (LiveOdds only ever wants the number for the current view).
// - A reply slower than the display budget (500 ms, api.analysis.v1 A-ANL-METRICS budget) is logged silently as
//   E-ANL-SLOW with its duration; the user just sees "calculating" a little longer (exceptions.md 2.8).
// - Replies are structured clones (`unknown`) and are shape-checked before they reach the screen. A message
//   without the current reqId (unreadable or stale) is ignored; a reply for the current request whose body fails
//   the check rejects with 'metrics reply malformed', so LiveOdds never waits forever (lead review R0 3.2 m2).
//
// ponytail: every request is posted, so a superseded one still computes in the Worker before the latest one;
// if E-ANL-SLOW shows queue build-up, keep one request in flight plus one pending (latest wins).
// ponytail: a Worker that really crashes while offline cannot be respawned (its script is fetched again), so LiveOdds
// stays hidden until the tab is online; precache the Worker script with a Service Worker once offline crash
// recovery is required (same ceiling and trigger as the practice host, lead review 2 R0-L12).
// ponytail: a script load that hangs without an error event leaves prewarmMetrics() (and any compute) pending, as
// there is no load deadline and the browser's network timeout decides; add one if a field report shows the PR-01
// offline line never drawn, or LiveOdds stuck on "calculating", on a working connection.
import type { DecisionMetrics, MetricsPrecision, MetricsView } from '@checky/analysis';
import { debugLog } from '@/config';
import type { MetricsRequest } from './metrics.worker';

/** What the client needs from a Worker; tests pass a fake. */
export interface MetricsPort {
  post(msg: MetricsRequest): void;
  /** Both callbacks fire from later tasks, never inside listen() itself (a Worker's events are always queued). */
  listen(onData: (data: unknown) => void, onFail: () => void): void;
  terminate(): void;
}

export const SLOW_MS = 500;

const isRec = (v: unknown): v is Readonly<Record<string, unknown>> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

export function isDecisionMetrics(v: unknown): v is DecisionMetrics {
  if (!isRec(v) || !isRec(v.equity) || !isRec(v.position)) return false;
  const e = v.equity;
  const po = v.potOdds;
  return (
    isNum(e.value) &&
    (e.method === 'exact' || e.method === 'mc') &&
    isNumOrNull(e.samples) &&
    isNumOrNull(e.halfWidth95) &&
    isNum(e.opponents) &&
    (po === null || (isRec(po) && isNum(po.pot) && isNum(po.call))) &&
    isNumOrNull(v.requiredEquity) &&
    isNum(v.effectiveStack) &&
    isNumOrNull(v.spr) &&
    typeof v.position.label === 'string' &&
    (v.position.inPosition === null || typeof v.position.inPosition === 'boolean') &&
    (v.verdict === null || v.verdict === 'call_ok' || v.verdict === 'call_short') &&
    v.basis === 'vs_random_hands'
  );
}

interface Pending {
  reqId: number;
  startedMs: number;
  resolve(m: DecisionMetrics): void;
  reject(e: unknown): void;
}

export function createMetricsClient(spawn: () => MetricsPort, now: () => number = () => performance.now()) {
  let port: MetricsPort | null = null;
  // Readiness of the live port, replaced with every spawn; ensurePort() always runs before it is read.
  let ready: Promise<boolean> = Promise.resolve(false);
  let pending: Pending | null = null;
  let nextId = 1;

  const fail = (): void => {
    port?.terminate();
    port = null;
    pending?.reject(new Error('metrics worker failed'));
    pending = null;
  };

  const onData = (data: unknown): void => {
    const p = pending;
    if (p === null || !isRec(data) || data.reqId !== p.reqId) return; // unreadable or stale: the current request still waits
    pending = null;
    const ms = now() - p.startedMs;
    if (ms > SLOW_MS) debugLog('E-ANL-SLOW', { ms: Math.round(ms) });
    if (data.ok === true && isDecisionMetrics(data.metrics)) p.resolve(data.metrics);
    else if (data.ok === false) p.reject(new Error('metrics request rejected by the worker'));
    else p.reject(new Error('metrics reply malformed'));
  };

  /** The live port, spawning one when none is up. If spawn() throws, `port` stays null and the next call retries. */
  const ensurePort = (): MetricsPort => {
    if (port === null) {
      const p = spawn();
      // Settled by this Worker's own events only (a closure per spawn), so a dropped Worker cannot settle the
      // readiness of its successor. Whichever comes first wins; later calls are no-ops.
      let settle: (ok: boolean) => void = () => undefined;
      const r = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      p.listen(
        (data) => {
          settle(true); // any message proves the script runs; onData still ignores one without the current reqId
          onData(data);
        },
        () => {
          settle(false);
          // Only the live port may fail the client: a late error from a Worker already dropped must not kill its successor.
          if (port === p) fail();
        },
      );
      port = p;
      ready = r;
    }
    return port;
  };

  return {
    /**
     * Spawns the Worker now unless one is up, and returns its readiness: the same promise while that Worker lives.
     * Never rejects and posts nothing, so it costs no reqId and no computation.
     */
    warm(): Promise<boolean> {
      try {
        ensurePort();
      } catch {
        // No port was kept; the next warm() or compute() spawns again (and compute rejects its own promise).
        return Promise.resolve(false);
      }
      return ready;
    },
    compute(view: MetricsView, precision: MetricsPrecision): Promise<DecisionMetrics> {
      let live: MetricsPort;
      try {
        live = ensurePort();
      } catch (cause) {
        // Nothing can be pending here: a pending request always has a live port, and fail() clears both together.
        return Promise.reject(new Error('metrics worker failed', { cause }));
      }
      pending?.reject(new DOMException('Superseded by a newer metrics request.', 'AbortError'));
      const reqId = nextId;
      nextId += 1;
      const promise = new Promise<DecisionMetrics>((resolve, reject) => {
        pending = { reqId, startedMs: now(), resolve, reject };
      });
      live.post({ reqId, kind: 'view', view, precision });
      return promise;
    },
  };
}

function spawnWorker(): MetricsPort {
  // One expression with a static options literal: the only form Vite detects and bundles as a module Worker.
  const worker = new Worker(new URL('./metrics.worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (msg) => worker.postMessage(msg),
    listen(onData, onFail) {
      worker.onmessage = (e: MessageEvent<unknown>) => onData(e.data);
      worker.onerror = () => onFail();
      worker.onmessageerror = () => onFail();
    },
    terminate: () => worker.terminate(),
  };
}

let shared: ReturnType<typeof createMetricsClient> | null = null;

function sharedClient(): ReturnType<typeof createMetricsClient> {
  shared ??= createMetricsClient(spawnWorker);
  return shared;
}

/** Screen-side metrics for the viewer's own view. Rejects with AbortError when a newer request supersedes it. */
export function computeMetricsAsync(view: MetricsView, precision: MetricsPrecision): Promise<DecisionMetrics> {
  return sharedClient().compute(view, precision);
}

/**
 * Spawns the tab's shared metrics Worker now so its script is fetched while online (lead review 2 R0-L12), and
 * resolves once it is known whether that Worker runs (lead review 4 R0-L35): true on its first message, false when
 * the spawn throws or the Worker fails first. Never throws or rejects, and never computes. While the same Worker
 * lives every call returns the same promise; after a failure the next call spawns again and returns a new one.
 */
export function prewarmMetrics(): Promise<boolean> {
  return sharedClient().warm();
}

// metrics Worker (A-AI-METRICS-ASYNC, I-08): runs computeMetrics off the main thread so LiveOdds never blocks UI.
//
// `handle` is a pure request -> reply function so tests call it directly (no Worker shim dependency). The message
// is a discriminated union on `kind` because 4-2 adds record-time requests (computeMetricsAtAsync) to this Worker.
// Messages arrive as structured clones (`unknown`), so the view is rebuilt field by field into the MetricsView
// that computeMetrics reads; it is never asserted to PlayerView (D-L10). The Worker only ever receives the
// viewer's own view (ADR-0003: no other seat's hidden cards on the main thread, so none here either).
//
// Vite rules (T-020): this file is loaded with `new Worker(new URL('./metrics.worker.ts', import.meta.url),
// { type: 'module' })` in client.ts and must not use dynamic import() (worker.format is 'iife' in Vite 6).
import { computeMetrics, DISPLAY_EXACT_LIMIT, type DecisionMetrics, type MetricsPrecision, type MetricsView } from '@checky/analysis';
import type { Card, Street } from '@checky/engine/protocol';
import type { Rng } from '@checky/engine/util';
import { createCryptoRng } from './rng';

export interface MetricsRequest {
  reqId: number;
  kind: 'view';
  view: MetricsView;
  precision: MetricsPrecision;
}

export type MetricsReply = { reqId: number; ok: true; metrics: DecisionMetrics } | { reqId: number; ok: false };

/**
 * The Worker's first message, posted once its entry is wired (lead review 4 R0-L35): proof that the script was
 * fetched and runs. It has no reqId, so the client can never take it for a reply to a compute request.
 */
export const METRICS_READY = { kind: 'ready' } as const;

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
// Hand copies of engine values: ai may only type-import @checky/engine/protocol (eslint boundary), so the card
// pattern and the STREETS / ACTION_TYPES lists are repeated here. A drift would turn every view into ok:false;
// packages/analysis/test/worker-copies.test.ts reads this file and asserts all three equal the engine's.
const CARD_RE = /^[2-9TJQKA][shdc]$/;
const STREETS: readonly string[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'RUNOUT', 'SHOWDOWN', 'COMPLETE', 'VOIDED'];
const ACTION_TYPES: readonly string[] = ['post_sb', 'post_bb', 'fold', 'check', 'call', 'bet', 'raise', 'allin'];
const isCard = (v: unknown): v is Card => typeof v === 'string' && CARD_RE.test(v);
const isStreet = (v: unknown): v is Street => typeof v === 'string' && STREETS.includes(v);

type Seat = MetricsView['seats'][number];
type Hand = NonNullable<MetricsView['hand']>;

function readSeat(raw: unknown): Seat | null {
  if (!isRec(raw) || !isInt(raw.seat)) return null;
  if (raw.occupant === null) return { seat: raw.seat, occupant: null };
  const o = raw.occupant;
  if (!isRec(o) || typeof o.isMe !== 'boolean' || !isInt(o.stack)) return null;
  let inHand: NonNullable<Seat['occupant']>['inHand'] = null;
  if (o.inHand !== null) {
    const h = o.inHand;
    if (!isRec(h) || !isInt(h.bet) || typeof h.folded !== 'boolean' || typeof h.position !== 'string') return null;
    inHand = { bet: h.bet, folded: h.folded, position: h.position };
  }
  return { seat: raw.seat, occupant: { isMe: o.isMe, stack: o.stack, inHand } };
}

function readHand(raw: unknown): Hand | null | undefined {
  if (raw === null) return null;
  if (!isRec(raw) || !isStreet(raw.street) || !isInt(raw.buttonSeat) || !Array.isArray(raw.board) || !Array.isArray(raw.actions) || !Array.isArray(raw.startStacks)) {
    return undefined;
  }
  const board: Card[] = [];
  for (const c of raw.board as unknown[]) {
    if (!isCard(c)) return undefined;
    board.push(c);
  }
  const actions: Hand['actions'][number][] = [];
  for (const a of raw.actions as unknown[]) {
    if (!isRec(a) || !isStreet(a.street) || !isInt(a.seat) || !isInt(a.added) || typeof a.type !== 'string' || !ACTION_TYPES.includes(a.type)) return undefined;
    actions.push({ street: a.street, seat: a.seat, type: a.type as Hand['actions'][number]['type'], added: a.added });
  }
  const startStacks: { seat: number; stack: number }[] = [];
  for (const s of raw.startStacks as unknown[]) {
    if (!isRec(s) || !isInt(s.seat) || !isInt(s.stack)) return undefined;
    startStacks.push({ seat: s.seat, stack: s.stack });
  }
  return { street: raw.street, board, buttonSeat: raw.buttonSeat, actions, startStacks };
}

/** Structural copy of exactly the fields computeMetrics reads; null when anything has the wrong shape. */
export function readMetricsView(raw: unknown): MetricsView | null {
  if (!isRec(raw) || !isRec(raw.me) || !Array.isArray(raw.seats)) return null;
  const me = raw.me;
  if (!(me.seat === null || isInt(me.seat))) return null;
  let holeCards: [Card, Card] | null = null;
  if (me.holeCards !== null) {
    if (!Array.isArray(me.holeCards) || me.holeCards.length !== 2) return null;
    const [a, b] = me.holeCards as unknown[];
    if (!isCard(a) || !isCard(b)) return null;
    holeCards = [a, b];
  }
  let legal: MetricsView['me']['legal'] = null;
  if (me.legal !== null) {
    if (!isRec(me.legal)) return null;
    const call = me.legal.call;
    if (call === null) legal = { call: null };
    else if (isRec(call) && isInt(call.amount) && isInt(call.to)) legal = { call: { amount: call.amount, to: call.to } };
    else return null;
  }
  const seats: Seat[] = [];
  for (const s of raw.seats as unknown[]) {
    const seat = readSeat(s);
    if (seat === null) return null;
    seats.push(seat);
  }
  const hand = readHand(raw.hand);
  if (hand === undefined) return null;
  return { me: { seat: me.seat, holeCards, legal }, seats, hand };
}

/**
 * Exact-enumeration budget of this Worker. After a display reply that was exact but took longer than the display
 * budget, the budget is divided by 4 so the same kind of spot goes Monte Carlo next time (exceptions.md E-ANL-SLOW,
 * D-S7: never fewer samples, only less enumeration). Starts at the analysis default.
 */
export interface WorkerBudget {
  exactLimit: number;
}

/** Display budget (api.analysis.v1 A-ANL-METRICS: p95 <= 500 ms). client.ts logs E-ANL-SLOW past the same value. */
const SLOW_MS = 500;

/** One request -> one reply. null only when not even a reqId can be read (nothing to answer to). */
export function handle(
  msg: unknown,
  rng: Rng,
  budget: WorkerBudget = { exactLimit: DISPLAY_EXACT_LIMIT },
  now: () => number = () => performance.now(),
): MetricsReply | null {
  if (!isRec(msg) || !isInt(msg.reqId)) return null;
  const reqId = msg.reqId;
  if (msg.kind !== 'view' || (msg.precision !== 'display' && msg.precision !== 'bot')) return { reqId, ok: false };
  const view = readMetricsView(msg.view);
  if (view === null) return { reqId, ok: false };
  const display = msg.precision === 'display';
  try {
    const t0 = now();
    const metrics = computeMetrics(view, display ? { precision: 'display', rng, exactLimit: budget.exactLimit } : { precision: 'bot', rng });
    if (display && metrics.equity.method === 'exact' && now() - t0 > SLOW_MS) budget.exactLimit = Math.floor(budget.exactLimit / 4);
    return { reqId, ok: true, metrics };
  } catch {
    // Precondition failures (no hole cards, no opponent left) are caller bugs; the client rejects the promise.
    return { reqId, ok: false };
  }
}

// Worker entry. There is no `document` inside a Worker; in the page (or happy-dom tests importing `handle`) the
// entry stays unwired so importing this file never hijacks window.onmessage.
interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent<unknown>) => void) | null;
}
if (typeof document === 'undefined') {
  const scope = self as unknown as WorkerScope;
  const rng = createCryptoRng();
  const budget: WorkerBudget = { exactLimit: DISPLAY_EXACT_LIMIT };
  scope.onmessage = (e) => {
    const reply = handle(e.data, rng, budget);
    if (reply !== null) scope.postMessage(reply);
  };
  // Posted after onmessage is set, so "ready" also means requests are being handled. No request triggers it, so
  // it costs no reqId and no computation, and it never waits behind a compute already queued by the client.
  scope.postMessage(METRICS_READY);
}

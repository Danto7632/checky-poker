// Timer ids and turn scheduling (SS9 turn timer, DV25 bot thinking, runout pacing, DV5 countdown).
//
// The reducer never waits: it emits TIMER_START/TIMER_CANCEL effects and the shell feeds a TIMER input back
// when one fires. Ids embed the hand and turn they belong to, so a timer that fires late for an older turn is
// recognised and ignored instead of acting on the wrong player.
import { randomInt } from '../util/rng';
import { randomId } from '../util/ids';
import type { Effect, ReduceCtx, TableState } from './state';

// All-in runout pacing (ADR-0001: 450 ms before the first street, 700 ms between the next ones), mirroring
// config defaults.runoutDelaysMs (session/contract-codes.test.ts keeps them equal). TableConfig has no field for it.
// ponytail: fixed runout delays, add TableConfig.runoutDelaysMs (contract change) if E2E needs to shorten them.
export const RUNOUT_DELAYS_MS = [450, 700] as const;

export const NEXT_HAND_TIMER = 'next';
export const turnTimerId = (handId: string, turnSeq: number): string => `turn:${handId}:${turnSeq}`;
export const botTimerId = (reqId: string): string => `bot:${reqId}`;
export const runoutTimerId = (handId: string): string => `runout:${handId}`;

export function cancelTurnTimer(t: TableState, fx: Effect[]): void {
  if (t.turnTimerId !== null) fx.push({ t: 'TIMER_CANCEL', id: t.turnTimerId });
  t.turnTimerId = null;
  t.turnDeadline = null;
}

/**
 * Called whenever `hand.toAct` may have changed. Human turn: start the turn timer unless the room has no limit
 * (practice turnSeconds null — no timer, no timeout, no strikes, AF-01). Bot turn: open a bot request and a
 * thinking delay picked from botThinkMs with the injected rng. Bots never use the human timer.
 */
export function scheduleTurn(t: TableState, fx: Effect[], ctx: ReduceCtx): void {
  cancelTurnTimer(t, fx);
  t.pendingBot = null;
  const hand = t.hand;
  if (hand === null || hand.toAct === null) return;
  const seat = t.seats[hand.toAct];
  if (seat === null || seat === undefined) return;
  if (seat.kind === 'human') {
    const secs = t.config.settings.turnSeconds;
    if (secs === null) return;
    const ms = secs * 1000;
    t.turnTimerId = turnTimerId(hand.handId, hand.turnSeq);
    t.turnDeadline = t.nowMs + ms;
    fx.push({ t: 'TIMER_START', id: t.turnTimerId, ms });
    return;
  }
  const reqId = randomId(ctx.rng, 9);
  const [lo, hi] = t.config.botThinkMs;
  const think = lo + randomInt(ctx.rng, Math.max(0, hi - lo) + 1);
  t.pendingBot = { reqId, seat: seat.seat, handId: hand.handId, turnSeq: hand.turnSeq, arrived: false, decision: null, thinkDone: false };
  fx.push({ t: 'BOT_REQUEST', reqId, seat: seat.seat, deadlineMs: t.config.llmDecisionTimeoutMs });
  fx.push({ t: 'TIMER_START', id: botTimerId(reqId), ms: think });
}

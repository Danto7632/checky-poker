// Hand lifecycle inside a table (SS4, SS10, SS12 + 1.0.4-p1 pause_rule / sitout_rule.practice, lead R0 round).
//
//   startHand      dealable seats, button moves clockwise, createHand, schedule the first turn (invariant-guarded)
//   afterHand      every hand-engine transition goes through here: runout pacing, next turn, or hand end
//   handEnd        stacks back to seats, refill hint, CLOSED if closing; else the between-hands seat work
//                  (busted humans sit out, practice bots refill — D-P4) and then PAUSED or BETWEEN_HANDS
//   countdownEnd   PAUSED or the next hand
//   voidHand       start stacks restored (B-E7, E-ENG-INVARIANT)
// The seat work runs at hand end, BEFORE the pause branch, so every way out of the hand (countdown, pending
// pause, sit-out pause) deals from the same seats (R0 M1: a bot busted into a pause used to stay at 0 chips).
// Practice AND friend rooms (R0-L6): a pending pause stops right at hand end (no countdown); Pause between hands
// stops at once. Practice only (sitout_rule): if the human sat out (self/timeout) the room pauses at hand end; a
// busted human keeps the countdown to refill (D-P12 brings them back) and the room pauses at countdown end
// otherwise (story AC-7). Arena keeps "pause when the countdown ends" until 3-1 adds pause_rule.arena.
import { createHandWithEvents } from '../hand/create';
import type { EngineEvent } from '../hand/events';
import { envelope } from '../protocol/envelope';
import type { NoticeCode } from '../protocol/codes';
import { CheckyError } from '../util/checky-error';
import { randomId } from '../util/ids';
import { randomInt } from '../util/rng';
import { NEXT_HAND_TIMER, RUNOUT_DELAYS_MS, cancelTurnTimer, runoutTimerId, scheduleTurn } from './timers';
import { dealableSeats, humanSeats, type Effect, type ReduceCtx, type TableState } from './state';

export function notice(fx: Effect[], code: NoticeCode, p: Record<string, unknown> = {}, to: 'local' | 'all' = 'all'): void {
  fx.push({ t: 'SEND', to, env: envelope('H.NOTICE', 0, { code, p }) });
}

/** In practice the only human is this device's viewer, so "to target" notices are local. */
function noticeToSeat(t: TableState, fx: Effect[], seat: number, code: NoticeCode, p: Record<string, unknown> = {}): void {
  if (seat === t.hostSeat) notice(fx, code, p, 'local');
  // ponytail: target notices for remote guests need the seat -> conn map; 2-1 adds it with seating.ts.
}

function nextButton(t: TableState, dealable: number[], ctx: ReduceCtx): number {
  if (t.buttonSeat === null) return dealable[randomInt(ctx.rng, dealable.length)]!;
  return dealable.find((s) => s > t.buttonSeat!) ?? dealable[0]!;
}

/**
 * Deal the next hand. Fewer than 2 dealable seats -> PAUSED ("waiting for players", E-ENG-INVALID-INIT silent).
 * Guarded here, once, for every caller (START, countdown end, resume): an E-ENG-INVARIANT while dealing pauses
 * the room with the alert like any other hand-engine call instead of crashing the Worker (R0 m4).
 */
export function startHand(t: TableState, fx: Effect[], ctx: ReduceCtx): void {
  const dealable = dealableSeats(t);
  if (dealable.length < 2) {
    enterPaused(t, fx, false);
    fx.push({ t: 'ERROR', code: 'E-ENG-INVALID-INIT' });
    return;
  }
  guardInvariant(t, fx, () => {
    for (const s of dealable) if (s.status === 'WAITING_NEXT') s.status = 'ACTIVE';
    const button = nextButton(
      t,
      dealable.map((s) => s.seat),
      ctx,
    );
    const handId = randomId(ctx.rng, 16);
    const { settings } = t.config;
    const { state, events } = createHandWithEvents(
      { handId, seats: dealable.map((s) => ({ seat: s.seat, stack: s.stack })), buttonSeat: button, sb: settings.sb, bb: settings.bb },
      ctx.rng,
    );
    t.buttonSeat = button;
    t.handNo += 1;
    t.hand = state;
    t.phase = t.closingAfterHand ? 'CLOSING_AFTER_HAND' : 'IN_HAND';
    t.countdownDeadline = null;
    t.appliedActs = [];
    t.voidedHandId = null;
    afterHand(t, fx, ctx, events);
  });
}

/** Route the result of a hand-engine call: COMPLETE -> handEnd, RUNOUT -> pacing timer, else the next turn. */
export function afterHand(t: TableState, fx: Effect[], ctx: ReduceCtx, events: EngineEvent[]): void {
  const hand = t.hand!;
  if (hand.street === 'COMPLETE') {
    handEnd(t, fx);
    return;
  }
  if (hand.street === 'RUNOUT') {
    cancelTurnTimer(t, fx);
    t.pendingBot = null;
    const first = events.some((e) => e.t === 'RunoutStarted');
    fx.push({ t: 'TIMER_START', id: runoutTimerId(hand.handId), ms: first ? RUNOUT_DELAYS_MS[0] : RUNOUT_DELAYS_MS[1] });
    return;
  }
  scheduleTurn(t, fx, ctx);
}

/**
 * sitout_rule.practice: nobody human is playing, so no next hand. `includeBust` = false at hand end, because a
 * seat that just busted still has the countdown to refill (AC-7); at countdown end every sitting-out seat counts.
 */
function practiceHumanSittingOut(t: TableState, includeBust: boolean): boolean {
  return (
    t.config.kind === 'practice' &&
    humanSeats(t).some((s) => s.status === 'SITTING_OUT' && (includeBust || s.sitOutReason !== 'bust'))
  );
}

/** Practice and friend rooms share pause_rule.practice (R0-L6); arena gets its own rule in 3-1. */
export function pausesAtHandEnd(t: TableState): boolean {
  return t.config.kind !== 'arena';
}

/** Between-hands seat work, once per finished hand: busted humans sit out (R9), practice bots refill (D-P4). */
function settleSeatsAfterHand(t: TableState): void {
  for (const s of t.seats) {
    if (s === null || s.stack > 0) continue;
    if (s.kind === 'bot' && t.config.kind === 'practice') {
      s.stack = t.config.settings.startStack;
    } else if (s.kind === 'human' && s.status !== 'SITTING_OUT') {
      s.status = 'SITTING_OUT'; // B-E5/R9: no cards, no blinds, no pot until a refill (D-P12 brings it back)
      s.sitOutReason = 'bust';
    }
  }
}

export function enterPaused(t: TableState, fx: Effect[], announce: boolean): void {
  cancelTurnTimer(t, fx);
  t.pendingBot = null;
  if (t.countdownDeadline !== null) fx.push({ t: 'TIMER_CANCEL', id: NEXT_HAND_TIMER });
  t.countdownDeadline = null;
  t.phase = 'PAUSED';
  t.paused = true;
  if (announce) notice(fx, 'N-PAUSED');
}

export function handEnd(t: TableState, fx: Effect[]): void {
  const hand = t.hand!;
  cancelTurnTimer(t, fx);
  t.pendingBot = null;
  for (const e of hand.result!.endStacks) {
    const seat = t.seats[e.seat];
    if (seat) seat.stack = e.stack;
  }
  t.handsPlayed += 1;
  for (const s of humanSeats(t)) {
    if (s.stack === 0 && t.config.kind === 'practice') noticeToSeat(t, fx, s.seat, 'N-REFILL-HINT');
  }
  if (t.closingAfterHand) {
    // The room ends here, so no between-hands seat work (no refill, no bust sit-out). H.CLOSED reports each
    // seat's table stack at the moment of closing (R0-L17): here the stacks this hand ended with. A practice room
    // closed later, during the countdown, reports them after the D-P4 bot refill.
    closeRoom(t, fx, 'host_closed');
    return;
  }
  settleSeatsAfterHand(t);
  if ((t.paused && pausesAtHandEnd(t)) || practiceHumanSittingOut(t, false)) {
    // pause_rule / sitout_rule.practice: stop right here, no countdown; hand and result stay on screen (R0-L1).
    enterPaused(t, fx, true);
    return;
  }
  t.phase = 'BETWEEN_HANDS';
  // R0 never has bot reveals (3-1 assembles them); with reveals the longer countdown applies (DV5).
  // ponytail: countdown is always nextHandDelayMs, use nextHandDelayWithRevealMs once 3-1 fills result.botReveals.
  const ms = t.config.nextHandDelayMs;
  t.countdownDeadline = t.nowMs + ms;
  fx.push({ t: 'TIMER_START', id: NEXT_HAND_TIMER, ms });
}

export function countdownEnd(t: TableState, fx: Effect[], ctx: ReduceCtx): void {
  t.countdownDeadline = null;
  // t.paused is still pending here only in arena rooms (the others pause at hand end or at once).
  if (t.paused || practiceHumanSittingOut(t, true)) {
    enterPaused(t, fx, true);
    return;
  }
  startHand(t, fx, ctx);
}

/** Void the running hand: every dealt seat gets its start stack back (B-E7). No record is written for it. */
export function voidRunningHand(t: TableState, fx: Effect[]): void {
  const hand = t.hand;
  if (hand === null || hand.street === 'COMPLETE' || hand.street === 'VOIDED') return;
  for (const x of hand.startStacks) {
    const seat = t.seats[x.seat];
    if (seat) seat.stack = x.stack;
  }
  t.hand = { ...hand, street: 'VOIDED', toAct: null, turnSeq: hand.turnSeq + 1 };
  t.voidedHandId = hand.handId;
  cancelTurnTimer(t, fx);
  t.pendingBot = null;
}

/** E-ENG-INVARIANT: the hand is voided and the room pauses; the host screen shows the alert (W.ERROR). */
export function invariantFailure(t: TableState, fx: Effect[]): void {
  voidRunningHand(t, fx);
  enterPaused(t, fx, true);
  fx.push({ t: 'ERROR', code: 'E-ENG-INVARIANT' });
}

export function closeRoom(t: TableState, fx: Effect[], reason: 'host_closed' | 'host_closed_now'): void {
  cancelTurnTimer(t, fx);
  t.pendingBot = null;
  if (t.countdownDeadline !== null) fx.push({ t: 'TIMER_CANCEL', id: NEXT_HAND_TIMER });
  t.countdownDeadline = null;
  t.phase = 'CLOSED';
  t.closingAfterHand = false;
  fx.push({
    t: 'SEND',
    to: 'all',
    env: envelope('H.CLOSED', 0, {
      summary: {
        reason,
        voidedHandId: t.voidedHandId,
        handsPlayed: t.handsPlayed,
        // The table seat stack at close (R0-L17); a voided hand has already given back its start stacks.
        seats: t.seats.flatMap((s) => (s === null ? [] : [{ seat: s.seat, name: s.nick, kind: s.kind, finalStack: s.stack }])),
        settings: t.config.settings,
      },
    }),
  });
  fx.push({ t: 'CLOSE_TRANSPORT' });
}

/** Wrap a hand-engine call: an E-ENG-INVARIANT voids and pauses; other errors propagate to the caller. */
export function guardInvariant(t: TableState, fx: Effect[], run: () => void): void {
  try {
    run();
  } catch (e) {
    if (e instanceof CheckyError && e.code === 'E-ENG-INVARIANT') {
      invariantFailure(t, fx);
      return;
    }
    throw e;
  }
}

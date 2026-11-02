// A-ENG-APPLY and A-ENG-FORCE-FOLD: pure, immutable hand transitions (R2-R8, R11-R13).
//
// Every rejected action throws BEFORE anything is copied, so a rejection can never leave a half-applied state
// (the caller keeps its old reference — "state unchanged"). Accepted actions return a new state + events.
// The closing logic (`advance`) is shared by actions, forced folds and hand creation:
//   one player left           -> settle by folds, COMPLETE
//   <= 1 player can still act -> R6: all-in runout (RUNOUT, cards dealt later by advanceRunout)
//   street complete (R5)      -> return uncalled, collect, deal next street, first actor left of the button (R2)
//   river complete            -> showdown, COMPLETE
import type { ActionType, AutoReason, EngineAction, SeatIndex, Street } from '../protocol/view-types';
import { CheckyError } from '../util/checky-error';
import type { EngineEvent } from './events';
import { legalActions } from './legal';
import { returnUncalled, settle } from './pots';
import { canAct, clockwiseAfter, cloneHand, isBettingStreet, type HandSeatState, type HandState } from './state';

const NEXT_STREET: Partial<Record<Street, { street: Street; deal: number }>> = {
  PREFLOP: { street: 'FLOP', deal: 3 },
  FLOP: { street: 'TURN', deal: 1 },
  TURN: { street: 'RIVER', deal: 1 },
};

export interface Applied {
  state: HandState;
  events: EngineEvent[];
}

export function applyAction(state: HandState, action: EngineAction): Applied {
  return applyActionWith(state, action, undefined);
}

/** applyAction plus the log marker for actions the table makes on a player's behalf (timeout check/fold). */
export function applyActionWith(state: HandState, action: EngineAction, auto: AutoReason | undefined): Applied {
  if (!isBettingStreet(state.street) || state.toAct === null || action.seat !== state.toAct) {
    throw new CheckyError('E-ACT-NOT-YOUR-TURN');
  }
  const legal = legalActions(state, action.seat);
  if (legal === null) throw new CheckyError('E-ACT-NOT-YOUR-TURN');
  const before = state.seats.find((p) => p.seat === action.seat)!;
  const to = action.to;
  const needsAmount = action.type === 'bet' || action.type === 'raise' || action.type === 'allin';
  if (needsAmount && (to === undefined || !Number.isInteger(to))) throw new CheckyError('E-ACT-AMOUNT');

  // Validate first (nothing copied yet), then compute the target street total.
  let target: number;
  switch (action.type) {
    case 'fold':
      target = before.bet;
      break;
    case 'check':
      if (!legal.check) throw new CheckyError('E-ACT-ILLEGAL');
      target = before.bet;
      break;
    case 'call':
      if (legal.call === null) throw new CheckyError('E-ACT-ILLEGAL');
      target = legal.call.to;
      break;
    case 'bet':
      if (legal.bet === null) throw new CheckyError('E-ACT-ILLEGAL');
      if (to! < legal.bet.min || to! > legal.bet.max) throw new CheckyError('E-ACT-AMOUNT');
      target = to!;
      break;
    case 'raise':
      if (legal.raise === null) throw new CheckyError('E-ACT-ILLEGAL');
      if (to! < legal.raise.minTo || to! > legal.raise.maxTo) throw new CheckyError('E-ACT-AMOUNT');
      target = to!;
      break;
    case 'allin':
      // Going all-in for MORE than the call is a bet/raise: only allowed while raising is open (R4) and someone
      // can still respond, so it is E-ACT-ILLEGAL (not an amount error) when raising is closed (B-E6, G-6).
      // An all-in for less than a full raise is allowed ("any amount" — G-4).
      if (to! > state.currentBet && !legal.reopened) throw new CheckyError('E-ACT-ILLEGAL');
      if (to !== legal.allIn.to) throw new CheckyError('E-ACT-AMOUNT');
      target = to;
      break;
    default:
      throw new CheckyError('E-ACT-ILLEGAL');
  }

  const s = cloneHand(state);
  const events: EngineEvent[] = [];
  const p = s.seats.find((x) => x.seat === action.seat)!;
  const added = target - p.bet;
  // With raising closed, `allIn.to` is capped at the call (legal.ts), so an 'allin' may leave chips behind.
  // The log records what happened: 'call'/'check' unless the last chip went in (then 'allin' below).
  let logged: ActionType = action.type === 'allin' ? (added > 0 ? 'call' : 'check') : action.type;
  if (action.type === 'fold') {
    p.folded = true;
  } else {
    p.stack -= added;
    p.bet = target;
    p.committed += added;
    if (p.stack === 0) {
      p.allIn = true;
      logged = 'allin';
    }
    if (target > s.currentBet) {
      const increment = target - s.currentBet;
      // A full raise resets the minimum increment; an under-raise all-in only moves the price (R3/R4).
      if (increment >= s.lastRaiseSize) s.lastRaiseSize = increment;
      s.currentBet = target;
      s.lastAggressor = p.seat;
    }
  }
  p.actedLevel = s.currentBet;
  const index = s.actions.length;
  p.lastActionIndex = index;
  s.actions.push({
    i: index,
    street: s.street,
    seat: p.seat,
    type: logged,
    to: p.bet,
    added: action.type === 'fold' ? 0 : added,
    ...(auto === undefined ? {} : { auto }),
  });
  events.push({ t: 'Acted', seat: p.seat, index });
  return { state: s, events: advance(s, events, p.seat) };
}

/**
 * R13: fold `seat` now, even out of turn (leave, kick). An all-in seat keeps its pot eligibility, so this is a
 * no-op for it. Folding a seat that already folded, or after the hand, is a no-op too.
 */
export function forceFold(state: HandState, seat: SeatIndex, reason: AutoReason): Applied {
  const cur = state.seats.find((p) => p.seat === seat);
  if (cur === undefined || cur.folded || cur.allIn || !isBettingStreet(state.street)) return { state, events: [] };
  const s = cloneHand(state);
  const p = s.seats.find((x) => x.seat === seat)!;
  p.folded = true;
  const index = s.actions.length;
  p.lastActionIndex = index;
  s.actions.push({ i: index, street: s.street, seat, type: 'fold', to: p.bet, added: 0, auto: reason });
  const events: EngineEvent[] = [{ t: 'Acted', seat, index }];
  // The turn only moves if it was this seat's; otherwise the same player keeps acting (unless the street closed).
  return { state: s, events: advance(s, events, state.toAct === seat ? seat : null) };
}

/** Street completion test (R5 + R6 trigger). */
function streetComplete(s: HandState): boolean {
  const able = s.seats.filter(canAct);
  if (able.length === 0) return true;
  if (able.length === 1 && able[0]!.bet >= s.currentBet) return true;
  return able.every((p) => p.actedLevel !== null && p.bet === s.currentBet);
}

function needsToAct(s: HandState, p: HandSeatState): boolean {
  return canAct(p) && (p.actedLevel === null || p.bet < s.currentBet);
}

function setTurn(s: HandState, seat: SeatIndex | null): void {
  s.toAct = seat;
  s.turnSeq += 1;
}

/**
 * Move the hand forward after a change by `actor` (null = the turn did not belong to the changed seat).
 * Mutates `s` (already a private clone) and returns the full event list.
 */
export function advance(s: HandState, events: EngineEvent[], actor: SeatIndex | null): EngineEvent[] {
  const live = s.seats.filter((p) => !p.folded);
  if (live.length <= 1) {
    const ret = returnUncalled(s);
    if (ret) events.push(ret);
    collect(s);
    return finish(s, events, false);
  }
  if (!streetComplete(s)) {
    if (actor !== null) {
      const next = clockwiseAfter(s, actor).find((p) => needsToAct(s, p));
      setTurn(s, next ? next.seat : null);
    }
    return events;
  }

  const ret = returnUncalled(s);
  if (ret) events.push(ret);
  collect(s);
  if (s.street === 'RIVER') return finish(s, events, true);
  if (s.seats.filter(canAct).length <= 1) {
    s.street = 'RUNOUT';
    setTurn(s, null);
    events.push({ t: 'RunoutStarted' });
    return events;
  }
  const step = NEXT_STREET[s.street]!;
  dealBoard(s, step.deal);
  s.street = step.street;
  // R12 looks at the aggressor of the LAST betting street, so each new street starts without one.
  s.lastAggressor = null;
  events.push({ t: 'StreetDealt', street: step.street, count: step.deal });
  const first = clockwiseAfter(s, s.buttonSeat).find(canAct)!;
  setTurn(s, first.seat);
  return events;
}

/** Close a betting round: bets move into the pot, nobody has acted, minimum increment back to BB. */
function collect(s: HandState): void {
  for (const p of s.seats) {
    p.bet = 0;
    p.actedLevel = null;
  }
  s.currentBet = 0;
  s.lastRaiseSize = s.bb;
}

export function dealBoard(s: HandState, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const card = s.deck.shift();
    if (card === undefined) throw new CheckyError('E-ENG-INVARIANT');
    s.board.push(card);
  }
}

/** Settle and close the hand. `showdown` = more than one player reached the end. */
export function finish(s: HandState, events: EngineEvent[], showdown: boolean): EngineEvent[] {
  if (showdown) s.street = 'SHOWDOWN';
  const settled = settle(s, showdown);
  s.result = settled.result;
  s.street = 'COMPLETE';
  setTurn(s, null);
  events.push(...settled.events, { t: 'HandCompleted' });
  const before = s.startStacks.reduce((a, x) => a + x.stack, 0);
  const after = s.result.endStacks.reduce((a, x) => a + x.stack, 0);
  // R11: chips are conserved exactly. A mismatch is a bug; the table voids the hand (E-ENG-INVARIANT).
  if (before !== after || s.seats.some((p) => p.stack < 0)) throw new CheckyError('E-ENG-INVARIANT');
  return events;
}

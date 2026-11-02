// A-ENG-LEGAL: what the seat to act may do (types.core.v1 LegalActions). The UI builds its buttons and amount
// ranges from this object only — it never computes betting rules itself (B-E4).
//
// Rules: min bet = BB, min raise increment = last FULL raise increment of the street (R3); an under-raise all-in
// does not reopen raising for a player who already acted unless the total raise they now face is a full raise
// (R4, TDA); with nobody else able to respond, betting and raising are closed (only call/fold make sense).
// `reopened` therefore means "raising is open for me" (R4 and someone can still respond).
// Every action this object advertises is accepted by applyAction ("advertised => accepted", property-tested).
// So `allIn.to` is the whole stack only while raising is open; when `reopened` is false it is capped at the
// call (or at my current bet when nothing is owed): min(maxTo, call?.to ?? myBet). Consumers draw a separate
// All-in control only when `allIn.to > (call?.to ?? myBet)` (lead decision R0 M2; the contract keeps
// `allIn: {to}` non-null).
// Readings fixed with 1-2/1-3 (impl-notes 0.1): fold always true on my turn; all-in call when stack <= call;
// bet null when stack < BB; raise null when maxTo < minTo (allIn remains) or when not reopened.
import type { LegalActions, SeatIndex } from '../protocol/view-types';
import { canAct, isBettingStreet, type HandSeatState, type HandState } from './state';

export function isReopened(s: HandState, p: HandSeatState): boolean {
  return p.actedLevel === null || s.currentBet - p.actedLevel >= s.lastRaiseSize;
}

export function othersCanAct(s: HandState, seat: SeatIndex): boolean {
  return s.seats.some((p) => p.seat !== seat && canAct(p));
}

export function legalActions(s: HandState, seat: SeatIndex): LegalActions | null {
  if (!isBettingStreet(s.street) || s.toAct !== seat) return null;
  const p = s.seats.find((x) => x.seat === seat);
  if (p === undefined || !canAct(p)) return null;

  const toCall = Math.max(0, s.currentBet - p.bet);
  const callAmount = Math.min(toCall, p.stack);
  const reopened = isReopened(s, p) && othersCanAct(s, seat);
  const maxTo = p.bet + p.stack;

  const call = toCall > 0 ? { amount: callAmount, to: p.bet + callAmount } : null;
  let bet: LegalActions['bet'] = null;
  let raise: LegalActions['raise'] = null;
  if (reopened && s.currentBet === 0 && p.stack >= s.bb) bet = { min: s.bb, max: maxTo };
  if (reopened && s.currentBet > 0) {
    const minTo = s.currentBet + s.lastRaiseSize;
    if (maxTo >= minTo) raise = { minTo, maxTo };
  }
  return {
    fold: true,
    check: toCall === 0,
    call,
    bet,
    raise,
    // Closed raising: only the all-in that is (at most) a call is still possible.
    allIn: { to: reopened ? maxTo : Math.min(maxTo, call?.to ?? p.bet) },
    reopened,
  };
}

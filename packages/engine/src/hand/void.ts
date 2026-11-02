// A-ENG-VOID (SS12 rule 3, B-E7): a voided hand gives every dealt seat its start-of-hand stack back. Nothing in
// the pot survives, so chip totals are preserved and no record is written for the hand.
import type { SeatIndex } from '../protocol/view-types';
import type { HandState } from './state';

export function voidHand(state: HandState): { startStacks: { seat: SeatIndex; stack: number }[] } {
  return { startStacks: state.startStacks.map((x) => ({ ...x })) };
}

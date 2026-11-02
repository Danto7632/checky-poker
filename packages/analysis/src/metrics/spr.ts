// Effective stack and SPR (SS20).
//
// effectiveStack = min(my stack, the largest remaining opponent stack), both taken at the start of the current
// street: a seat's street-start stack is `stack + inHand.bet` (bet = chips put in on this street).
// spr = flop-start effective stack / flop-start pot, null preflop. The flop-start figures are rebuilt from the
// public log: stack = startStack - sum(added on PREFLOP), pot = sum(added on PREFLOP), and the opponents are
// the seats that did not fold preflop (a later fold does not change a flop-start number).
import type { MetricsView } from '../bot/contract';

type Seats = MetricsView['seats'];

function mySeat(seats: Seats): Seats[number] | undefined {
  return seats.find((s) => s.occupant?.isMe === true);
}

export function effectiveStack(view: MetricsView): number {
  const me = mySeat(view.seats);
  const mine = me?.occupant ? me.occupant.stack + (me.occupant.inHand?.bet ?? 0) : 0;
  let largest = 0;
  for (const s of view.seats) {
    const o = s.occupant;
    if (o === null || o.isMe || o.inHand === null || o.inHand.folded) continue;
    largest = Math.max(largest, o.stack + o.inHand.bet);
  }
  return Math.min(mine, largest);
}

export function spr(view: MetricsView): number | null {
  const hand = view.hand;
  if (hand === null || hand.street === 'PREFLOP') return null;
  const me = mySeat(view.seats);
  if (me === undefined) return null;

  const preflopAdded = new Map<number, number>();
  const foldedPreflop = new Set<number>();
  let pot = 0;
  for (const a of hand.actions) {
    if (a.street !== 'PREFLOP') continue;
    pot += a.added;
    preflopAdded.set(a.seat, (preflopAdded.get(a.seat) ?? 0) + a.added);
    if (a.type === 'fold') foldedPreflop.add(a.seat);
  }
  if (pot <= 0) return null;

  const flopStack = (seat: number): number =>
    (hand.startStacks.find((x) => x.seat === seat)?.stack ?? 0) - (preflopAdded.get(seat) ?? 0);

  let largest = 0;
  for (const s of view.seats) {
    if (s.occupant === null || s.occupant.isMe || s.occupant.inHand === null || foldedPreflop.has(s.seat)) continue;
    largest = Math.max(largest, flopStack(s.seat));
  }
  return Math.min(flopStack(me.seat), largest) / pot;
}

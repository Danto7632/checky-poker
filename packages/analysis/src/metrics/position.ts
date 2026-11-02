// Position (SS20): engine label + in/out of position after the flop.
//
// The label is the engine's own `inHand.position` (positionLabels output, already in the view), so analysis
// never re-derives labels. In position = I sit after every opponent still in the hand in post-flop order, which
// starts at the first seat left of the button (heads-up: BB first, button last). Position is a seat-order fact:
// all-in opponents still count, only folded seats drop out (lead review R0 3.2 m1). Preflop: null.
import type { MetricsView } from '../bot/contract';

export function position(view: MetricsView): { label: string; inPosition: boolean | null } {
  const me = view.seats.find((s) => s.occupant?.isMe === true);
  const label = me?.occupant?.inHand?.position ?? '';
  const hand = view.hand;
  if (me === undefined || hand === null || hand.street === 'PREFLOP') return { label, inPosition: null };

  const n = view.seats.length;
  const order = (seat: number): number => (seat - hand.buttonSeat - 1 + n) % n;
  const mine = order(me.seat);
  const inPosition = view.seats.every((s) => {
    const o = s.occupant;
    if (o === null || o.isMe || o.inHand === null || o.inHand.folded) return true;
    return order(s.seat) < mine;
  });
  return { label, inPosition };
}

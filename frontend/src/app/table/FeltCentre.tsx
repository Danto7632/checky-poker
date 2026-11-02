// FeltCentre (components.md 3.6, ui-spec T-01 "felt centre · bottom slot", W5 R0-2 R0-L19): the one element in the
// middle of the felt. The Board is the anchor — centred at layout.BOARD_POINT (50 %, 56 %) — and the PotDisplay is
// attached to the board's top edge (bottom: 100 % + 8 px). Being one box in one flow, the pot can never overlap the
// board, and the board does not move when the pot appears or goes.
//
// Nothing with a button lives on the felt any more: the between-hands pill, the refill card and the sit-out card are
// in the bottom slot (BottomSlot.tsx), so no button can end up under the board cards (MS-R0-3 D4).
// The pot shows only while a hand is played (format.handInPlay): between hands its chips are already shared out (the
// amounts are in HandResult), and a leftover "POT" met the badges of a top seat whose cards were revealed (O2).
// ponytail: the pot disappears the moment the hand ends; M-WIN (chips fly to the winner, then a 140 ms fade) is not
// built in R0 — add the exit fade together with M-WIN (motion-spec; reduced motion keeps it immediate).
import type { PlayerView } from '@checky/engine/protocol';
import { Board } from './Board';
import { handInPlay, potTotal } from './format';
import { BOARD_POINT } from './layout';
import { PotDisplay } from './PotDisplay';

export function FeltCentre({ view }: { view: PlayerView }) {
  const hand = view.hand;
  return (
    <div className="absolute z-(--z-cards) -translate-x-1/2 -translate-y-1/2" style={{ left: `${BOARD_POINT.x}%`, top: `${BOARD_POINT.y}%` }}>
      {handInPlay(view.room.phase) ? (
        <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
          <PotDisplay total={potTotal(hand, view.seats)} pots={hand?.pots ?? []} />
        </div>
      ) : null}
      <Board cards={hand?.board ?? []} />
    </div>
  );
}

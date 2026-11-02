// Places every seat and its BetPill on the felt (layout.ts). Positions are CSS custom properties so one element
// serves layout B (< 768, --bx/--by) and layouts A/C (>= 768, --x/--y) without re-rendering on resize.
import type { CSSProperties } from 'react';
import type { HandResult, HandView, PlayerView, RoomPhase } from '@checky/engine/protocol';
import { defaults } from '@/config';
import { BetPill } from './BetPill';
import { handInPlay, seatTurnClock } from './format';
import { betPillPoint, screenPosition, seatPointA, seatPointB } from './layout';
import { Seat } from './Seat';
import { SeatEmpty } from './SeatEmpty';

function wonBySeat(result: HandResult | null, seat: number): number | null {
  if (result === null) return null;
  let total = 0;
  for (const pot of result.pots) {
    pot.winners.forEach((w, i) => {
      if (w === seat) total += pot.shares[i] ?? 0;
    });
  }
  return total > 0 ? total : null;
}

function lastActionOf(hand: HandView | null, seat: number) {
  if (hand === null) return null;
  for (let i = hand.actions.length - 1; i >= 0; i--) {
    const a = hand.actions[i];
    if (a !== undefined && a.seat === seat) return a;
  }
  return null;
}

const pos = (a: { x: number; y: number }, b: { x: number; y: number }): CSSProperties =>
  ({ '--x': `${a.x}%`, '--y': `${a.y}%`, '--bx': `${b.x}%`, '--by': `${b.y}%` }) as CSSProperties;

const PLACE = 'absolute left-(--bx) top-(--by) -translate-x-1/2 -translate-y-1/2 md:left-(--x) md:top-(--y)';

export function SeatRing({ view, phase }: { view: PlayerView; phase: RoomPhase }) {
  const { seats, hand, result, room, me } = view;
  const count = seats.length;
  const turnKey = hand === null ? 'none' : `${hand.handId}:${hand.turnSeq}`;
  return (
    <>
      {seats.map((s) => {
        const position = screenPosition(s.seat, me.seat, count);
        const a = seatPointA(position, count);
        const b = seatPointB(position, count);
        const bet = s.occupant?.inHand?.bet ?? 0;
        return (
          <div key={s.seat}>
            <div className={PLACE} style={pos(a, b)}>
              {s.occupant === null ? (
                <SeatEmpty seat={s.seat} />
              ) : (
                <Seat
                  seat={s.seat}
                  occupant={s.occupant}
                  isToAct={hand?.toAct === s.seat}
                  turn={seatTurnClock(s, hand, room.settings, defaults)}
                  turnKey={turnKey}
                  frozen={phase === 'PAUSED'}
                  inPlay={handInPlay(phase)}
                  lastAction={lastActionOf(hand, s.seat)}
                  isButton={hand?.buttonSeat === s.seat}
                  isSB={hand?.sbSeat === s.seat}
                  isBB={hand?.bbSeat === s.seat}
                  wonAmount={wonBySeat(result, s.seat)}
                />
              )}
            </div>
            {bet > 0 ? (
              <div className={`${PLACE} z-(--z-bet)`} style={pos(betPillPoint(a), betPillPoint(b))}>
                <BetPill amount={bet} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

// Position labels (A-ENG-POSITIONS), ported unchanged from backend store.service.ts:2638-2676 (D-P5):
// heads-up 'BTN/SB', 'BB'; three or more 'BTN', 'SB', 'BB', 'UTG', 'UTG+1', ... clockwise from the button.
import type { SeatIndex } from '../protocol/view-types';

function labelsForCount(count: number): string[] {
  if (count === 2) return ['BTN/SB', 'BB'];
  const labels = ['BTN', 'SB', 'BB'];
  for (let i = 3; i < count; i += 1) labels.push(i === 3 ? 'UTG' : `UTG+${Math.min(i - 3, 5)}`);
  return labels;
}

/** `seatOrder` = the seats dealt into the hand (any order); `buttonSeat` must be one of them. */
export function positionLabels(seatOrder: readonly SeatIndex[], buttonSeat: SeatIndex): Record<SeatIndex, string> {
  const sorted = [...seatOrder].sort((a, b) => a - b);
  const dealer = sorted.indexOf(buttonSeat);
  if (dealer < 0) throw new RangeError('positionLabels: button is not a dealt seat');
  const ordered = [...sorted.slice(dealer), ...sorted.slice(0, dealer)];
  const labels = labelsForCount(ordered.length);
  const out: Record<SeatIndex, string> = {};
  ordered.forEach((seat, i) => {
    out[seat] = labels[i] ?? 'UTG';
  });
  return out;
}

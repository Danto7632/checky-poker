// Seat geometry (ui-spec T-01 layouts, components.md 3.1). Coordinates are percentages of the felt box, measured
// at the avatar centre, clockwise, screen position 0 = me at the bottom centre.
//
// Layout A (>= 768 wide) uses the per-count table from ui-spec. Layout B (< 768 portrait) puts opponents on a rail
// arc above the felt; ui-spec gives the five rail points for a full table, and for fewer opponents we take an even
// subset of those points (interpretation recorded in frontend.md). Layout C (landscape phone) reuses A.
export interface Point {
  x: number;
  y: number;
}

const p = (x: number, y: number): Point => ({ x, y });

/** Layout A, indexed by seat count (2..6), then by screen position. */
export const LAYOUT_A: Readonly<Record<number, readonly Point[]>> = {
  2: [p(50, 104), p(50, -4)],
  3: [p(50, 104), p(12, 14), p(88, 14)],
  4: [p(50, 104), p(2, 50), p(50, -4), p(98, 50)],
  5: [p(50, 104), p(6, 64), p(26, -2), p(74, -2), p(94, 64)],
  6: [p(50, 104), p(6, 76), p(12, 14), p(50, -4), p(88, 14), p(94, 76)],
};

const RAIL_B: readonly Point[] = [p(8, 40), p(24, 6), p(50, 0), p(76, 6), p(92, 40)];
// Which rail points to use for 1..5 opponents (indices into RAIL_B), left to right = clockwise from my left.
const RAIL_PICK: Readonly<Record<number, readonly number[]>> = {
  1: [2],
  2: [1, 3],
  3: [1, 2, 3],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 3, 4],
};

/**
 * FeltCentre anchor, every layout (W5 R0-2 R0-L19): the BOARD's centre. The pot is attached on top of the board
 * (FeltCentre.tsx) instead of having its own point, so with the pot above it the pair centres near the felt middle.
 */
export const BOARD_POINT: Point = p(50, 56);
/** BetPill vectors point at the geometric centre of the felt. */
const FELT_CENTRE: Point = p(50, 50);

/** Screen position of a contract seat: (seat − me.seat + seatCount) % seatCount. Spectators use me = 0. */
export function screenPosition(seat: number, meSeat: number | null, seatCount: number): number {
  const me = meSeat ?? 0;
  return (((seat - me) % seatCount) + seatCount) % seatCount;
}

export function seatPointA(position: number, seatCount: number): Point {
  const table = LAYOUT_A[seatCount];
  const point = table?.[position];
  if (point === undefined) throw new RangeError(`no layout A point for position ${position} of ${seatCount}`);
  return point;
}

/** Layout B: position 0 (me) sits below the felt like layout A; opponents use the rail. */
export function seatPointB(position: number, seatCount: number): Point {
  if (position === 0) return p(50, 104);
  const pick = RAIL_PICK[seatCount - 1];
  const index = pick?.[position - 1];
  const point = index === undefined ? undefined : RAIL_B[index];
  if (point === undefined) throw new RangeError(`no layout B point for position ${position} of ${seatCount}`);
  return point;
}

/** BetPill: 30% of the way from the seat toward the felt centre (ui-spec T-01). */
export function betPillPoint(seat: Point): Point {
  return p(seat.x + 0.3 * (FELT_CENTRE.x - seat.x), seat.y + 0.3 * (FELT_CENTRE.y - seat.y));
}

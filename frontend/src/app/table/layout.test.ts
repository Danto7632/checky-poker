// Seat geometry tests: ui-spec T-01 coordinate table, rotation formula and the BetPill 30% point.
import { describe, expect, it } from 'vitest';
import { betPillPoint, LAYOUT_A, screenPosition, seatPointA, seatPointB } from './layout';

describe('layout A matches ui-spec T-01', () => {
  it.each([
    [6, [[50, 104], [6, 76], [12, 14], [50, -4], [88, 14], [94, 76]]],
    [5, [[50, 104], [6, 64], [26, -2], [74, -2], [94, 64]]],
    [4, [[50, 104], [2, 50], [50, -4], [98, 50]]],
    [3, [[50, 104], [12, 14], [88, 14]]],
    [2, [[50, 104], [50, -4]]],
  ] as const)('%d seats', (count, coords) => {
    expect(LAYOUT_A[count]?.map(({ x, y }) => [x, y])).toEqual(coords);
    coords.forEach(([x, y], i) => expect(seatPointA(i, count)).toEqual({ x, y }));
  });

  it('throws for a position outside the table', () => {
    expect(() => seatPointA(6, 6)).toThrow(RangeError);
  });
});

describe('screen position = (seat - me + n) % n', () => {
  it.each([
    [3, 3, 6, 0], // me at the bottom
    [4, 3, 6, 1],
    [0, 3, 6, 3],
    [2, 3, 6, 5],
    [0, null, 4, 0], // spectator: seat 0 at position 0
    [1, 0, 2, 1],
  ] as const)('seat %d, me %s, %d seats -> %d', (seat, me, n, expected) => {
    expect(screenPosition(seat, me, n)).toBe(expected);
  });
});

describe('layout B rail', () => {
  it('uses all five rail points for a full table and the middle one heads-up', () => {
    expect([1, 2, 3, 4, 5].map((pos) => seatPointB(pos, 6))).toEqual([
      { x: 8, y: 40 }, { x: 24, y: 6 }, { x: 50, y: 0 }, { x: 76, y: 6 }, { x: 92, y: 40 },
    ]);
    expect(seatPointB(1, 2)).toEqual({ x: 50, y: 0 });
    expect(seatPointB(0, 4)).toEqual({ x: 50, y: 104 });
  });
});

describe('BetPill point', () => {
  it('is 30% of the way from the seat to the felt centre', () => {
    expect(betPillPoint({ x: 50, y: 104 })).toEqual({ x: 50, y: 104 - 0.3 * 54 });
    const p = betPillPoint({ x: 6, y: 76 });
    expect(p.x).toBeCloseTo(19.2);
    expect(p.y).toBeCloseTo(68.2);
  });
});

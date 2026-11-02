// Equity self-checks that do not need the lead's oracle: analytic values, an independent brute-force
// enumeration (plain ordered loops, no relation table, no pair skipping) for the exact path's tie and
// disjointness logic, MC agreement with exact, precision metadata and input validation.
// Not a substitute for the independent-oracle golden (equity.golden.test.ts): these share the engine evaluator.
import { compareRanks, evaluate7 } from '@checky/engine';
import { CARD_RANKS, CARD_SUITS, type Card } from '@checky/engine/protocol';
import { createSeededRng } from '@checky/engine/util';
import { describe, expect, it } from 'vitest';
import { computeEquity, exactCost, N_BOT } from '../src/metrics/equity';

const DECK: Card[] = CARD_RANKS.flatMap((r) => CARD_SUITS.map((s): Card => `${r}${s}`));
const rest = (known: Card[]): Card[] => DECK.filter((c) => !known.includes(c));

// River, ordered opponents: every (holding1, holding2) with distinct cards; my share = 1/k if I am among the k best.
function bruteRiver(hole: Card[], board: Card[], opponents: 1 | 2): number {
  const d = rest([...hole, ...board]);
  const mine = evaluate7([...hole, ...board]);
  let total = 0;
  let count = 0;
  const holdings: [Card, Card][] = [];
  for (let a = 0; a < d.length; a += 1) for (let b = a + 1; b < d.length; b += 1) holdings.push([d[a]!, d[b]!]);
  for (const h1 of holdings) {
    const r1 = compareRanks(evaluate7([...h1, ...board]), mine);
    if (opponents === 1) {
      total += r1 < 0 ? 1 : r1 === 0 ? 0.5 : 0;
      count += 1;
      continue;
    }
    for (const h2 of holdings) {
      if (h2.includes(h1[0]) || h2.includes(h1[1])) continue;
      const r2 = compareRanks(evaluate7([...h2, ...board]), mine);
      count += 1;
      if (r1 > 0 || r2 > 0) continue;
      total += 1 / (1 + (r1 === 0 ? 1 : 0) + (r2 === 0 ? 1 : 0));
    }
  }
  return total / count;
}

const exactOpts = { samples: 10_000, exactLimit: Infinity, rng: createSeededRng('equity-exact') };

describe('exact enumeration', () => {
  it('board plays (royal on board): every player ties, value = 1/(N+1)', () => {
    const board: Card[] = ['As', 'Ks', 'Qs', 'Js', 'Ts'];
    expect(computeEquity(['2c', '3d'], board, 1, exactOpts)).toEqual({ value: 0.5, method: 'exact', samples: null, halfWidth95: null, opponents: 1 });
    expect(computeEquity(['2c', '3d'], board, 2, exactOpts).value).toBe(1 / 3);
  });

  it('the unbeatable, untieable nuts is exactly 1', () => {
    expect(computeEquity(['As', 'Ks'], ['Qs', 'Js', 'Ts', '2d', '3c'], 2, exactOpts).value).toBe(1);
  });

  it.each([
    ['AsKd', ['2c', '7h', '9s', 'Td', '3c']],
    ['8h8d', ['Kc', '7h', '2s', '3d', '4c']],
    ['7h6h', ['Ah', '9h', '2c', '3h', 'Kd']],
  ] as const)('river %s matches an independent ordered brute force (N = 1, 2) to 1e-12', (h, board) => {
    const hole = [h.slice(0, 2), h.slice(2)] as Card[];
    for (const n of [1, 2] as const) {
      expect(Math.abs(computeEquity(hole, [...board], n, exactOpts).value - bruteRiver(hole, [...board], n))).toBeLessThan(1e-12);
    }
  });

  it('turn exact agrees with a 200,000-sample Monte Carlo within 4 sigma', () => {
    const hole: Card[] = ['Jc', 'Tc'];
    const board: Card[] = ['9c', '8d', '2h', '3s'];
    const exact = computeEquity(hole, board, 1, exactOpts).value;
    const mc = computeEquity(hole, board, 1, { samples: 200_000, exactLimit: 0, rng: createSeededRng('equity-turn-mc') });
    expect(mc.method).toBe('mc');
    expect(Math.abs(mc.value - exact)).toBeLessThan((4 * mc.halfWidth95!) / 1.96);
  });
});

describe('Monte Carlo metadata and limits', () => {
  it('reports samples and halfWidth95 = 1.96 sqrt(p(1-p)/n)', () => {
    const r = computeEquity(['Qh', 'Jh'], [], 3, { samples: N_BOT, exactLimit: 0, rng: createSeededRng('meta') });
    expect(r.method).toBe('mc');
    expect(r.samples).toBe(1000);
    expect(Math.abs(r.halfWidth95! - 1.96 * Math.sqrt((r.value * (1 - r.value)) / 1000))).toBeLessThan(1e-12);
  });

  it('is deterministic for a fixed seed', () => {
    const a = computeEquity(['Td', '9d'], ['Ks', 'Qh', '2c'], 4, { samples: 2000, exactLimit: 0, rng: createSeededRng('same') });
    const b = computeEquity(['Td', '9d'], ['Ks', 'Qh', '2c'], 4, { samples: 2000, exactLimit: 0, rng: createSeededRng('same') });
    expect(a).toEqual(b);
  });

  it('exactCost: N >= 3 is never exact, more cards to come cost more', () => {
    expect(exactCost(5, 3)).toBe(Infinity);
    expect(exactCost(5, 1)).toBe(991);
    expect(exactCost(4, 1)).toBe(46 * 991);
    expect(exactCost(3, 1)).toBeGreaterThan(exactCost(4, 2));
  });

  it('rejects malformed inputs (caller bugs)', () => {
    const o = { samples: 10, exactLimit: 0, rng: createSeededRng(1) };
    expect(() => computeEquity(['As', 'As'], [], 1, o)).toThrow('duplicate');
    expect(() => computeEquity(['As', 'Kd'], ['2c'], 1, o)).toThrow('board');
    expect(() => computeEquity(['As', 'Kd'], [], 0, o)).toThrow('opponents');
    expect(() => computeEquity(['As', 'Kd'], [], 6, o)).toThrow('opponents');
  });
});

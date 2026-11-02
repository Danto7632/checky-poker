// Hand evaluator (A-ENG-EVAL), ported from backend store.service.ts:1950-2086 with the SAME comparison results.
//
// The backend scored all 21 five-card subsets of 7 cards and kept the best. This port computes the best
// {category, values} directly from rank/suit counts, which gives identical results (proven against a faithful
// port of the 21-subset version over random hands in test/cards/evaluator.test.ts) and is fast enough for the
// analysis Monte Carlo budget. Categories and values are exactly the backend's:
//   8 straight flush [high] · 7 quads [four, kicker] · 6 full house [trips, pair] · 5 flush [5 ranks]
//   4 straight [high] · 3 trips [trips, k1, k2] · 2 two pair [high, low, kicker] · 1 pair [pair, k1, k2, k3]
//   0 high card [5 ranks]       (ranks 2..14; the A-2-3-4-5 wheel has high 5)
import { RANK_CODES, type Card, type RankCode } from '../protocol/view-types';
import { cardIndex, rankValue, suitIndex } from './card';

export interface HandRank {
  /** 0 = high card ... 8 = straight flush */
  category: number;
  values: number[];
}

/** Highest straight in a rank bitmask (bit r set = rank r present, 2..14), 0 if none. */
function straightHigh(mask: number): number {
  // The ace also plays low: mirror bit 14 into bit 1.
  const m = mask & (1 << 14) ? mask | 2 : mask;
  for (let high = 14; high >= 5; high -= 1) {
    const run = 0b11111 << (high - 4);
    if ((m & run) === run) return high;
  }
  return 0;
}

/** Evaluate 5..7 card indices (0..51). Internal integer path used by the hand engine. */
export function evaluateIndices(cards: readonly number[]): HandRank {
  if (cards.length < 5 || cards.length > 7) throw new RangeError('evaluate: 5 to 7 cards');
  const counts = new Uint8Array(15);
  const suitCounts = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = rankValue(c);
    const s = suitIndex(c);
    counts[r]! += 1;
    suitCounts[s]! += 1;
    suitMasks[s]! |= 1 << r;
    mask |= 1 << r;
  }

  const flushSuit = suitCounts.findIndex((n) => n >= 5);
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]!);
    if (sf) return { category: 8, values: [sf] };
  }

  let quad = 0;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 14; r >= 2; r -= 1) {
    const n = counts[r]!;
    if (n === 4) quad = r;
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
  }
  /** Highest present ranks, excluding `skip`, up to `k` of them. */
  const top = (k: number, skip: readonly number[], m: number = mask): number[] => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < k; r -= 1) if (m & (1 << r) && !skip.includes(r)) out.push(r);
    return out;
  };

  if (quad) return { category: 7, values: [quad, ...top(1, [quad])] };
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const t = trips[0]!;
    return { category: 6, values: [t, Math.max(trips[1] ?? 0, pairs[0] ?? 0)] };
  }
  if (flushSuit >= 0) return { category: 5, values: top(5, [], suitMasks[flushSuit]!) };
  const st = straightHigh(mask);
  if (st) return { category: 4, values: [st] };
  if (trips.length > 0) return { category: 3, values: [trips[0]!, ...top(2, [trips[0]!])] };
  if (pairs.length >= 2) {
    const [hi, lo] = [pairs[0]!, pairs[1]!];
    // A third pair can be the kicker (AA KK QQ 2 -> [14, 13, 12]), exactly like the 21-subset search.
    return { category: 2, values: [hi, lo, ...top(1, [hi, lo])] };
  }
  if (pairs.length === 1) return { category: 1, values: [pairs[0]!, ...top(3, [pairs[0]!])] };
  return { category: 0, values: top(5, []) };
}

/** A-ENG-EVAL: best hand of 5..7 contract cards. Throws TypeError on an invalid card string. */
export function evaluate7(cards: readonly Card[]): HandRank {
  return evaluateIndices(cards.map(cardIndex));
}

/** -1 | 0 | 1, by category then values left to right. */
export function compareRanks(a: HandRank, b: HandRank): -1 | 0 | 1 {
  if (a.category !== b.category) return a.category > b.category ? 1 : -1;
  const n = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < n; i += 1) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

/** Language-free category code (AF-10, D-P6). The UI renders rank.<code>. */
export function rankLabel(r: HandRank): RankCode {
  const code = RANK_CODES[r.category];
  if (code === undefined) throw new RangeError('rank category out of range');
  return code;
}

/**
 * The five cards that make the best hand, ordered for display: bigger groups first, then higher rank
 * (wheel straights put the ace last). Ties between equal subsets resolve to the first in input order.
 */
export function bestFiveIndices(cards: readonly number[]): number[] {
  const best = evaluateIndices(cards);
  const n = cards.length;
  for (let a = 0; a < n - 4; a += 1)
    for (let b = a + 1; b < n - 3; b += 1)
      for (let c = b + 1; c < n - 2; c += 1)
        for (let d = c + 1; d < n - 1; d += 1)
          for (let e = d + 1; e < n; e += 1) {
            const five = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            if (compareRanks(evaluateIndices(five), best) === 0) return orderFive(five, best);
          }
  // Unreachable: some subset always achieves the best rank of the whole set.
  throw new RangeError('bestFive: no subset matched');
}

function orderFive(five: number[], rank: HandRank): number[] {
  const wheel = (rank.category === 4 || rank.category === 8) && rank.values[0] === 5;
  const value = (c: number): number => (wheel && rankValue(c) === 14 ? 1 : rankValue(c));
  const count = (c: number): number => five.filter((x) => rankValue(x) === rankValue(c)).length;
  return [...five].sort((x, y) => count(y) - count(x) || value(y) - value(x) || x - y);
}

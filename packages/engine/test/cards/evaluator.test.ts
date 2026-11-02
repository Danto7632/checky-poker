// AC-4 (S8): evaluator characterization 7/7, equivalence with the backend's 21-subset search, best5, labels,
// positions, deck, plus a throughput micro-benchmark for Stephen's Monte Carlo budget (task 3.2).
import { describe, expect, it } from 'vitest';
import { bestFiveIndices, compareRanks, evaluate7, evaluateIndices, rankLabel, type HandRank } from '../../src/cards/evaluator';
import { cardIndex, cardString } from '../../src/cards/card';
import { positionLabels } from '../../src/cards/positions';
import { shuffledDeck } from '../../src/cards/deck';
import { createSeededRng, randomInt } from '../../src/util/rng';
import type { Card } from '../../src/protocol/view-types';
import { testLog } from '../helpers/log';

const hand = (s: string): Card[] => s.split(' ').map((c) => (c[0]! + c[1]!.toLowerCase()) as Card);

// ---- Faithful port of backend store.service.ts evaluateFiveCards / chooseFiveFrom / evaluateBestHand -----------
function refFive(cards: number[]): HandRank {
  const ranks = cards.map((c) => (c >> 2) + 2).sort((a, b) => b - a);
  const suits = cards.map((c) => c & 3);
  const flush = suits.every((s) => s === suits[0]);
  const unique = Array.from(new Set(ranks)).sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  let straight: number | null = null;
  for (let i = 0; i <= unique.length - 5 && straight === null; i += 1) {
    const start = unique[i]!;
    let ok = true;
    for (let step = 1; step < 5; step += 1) if (!unique.includes(start - step)) ok = false;
    if (ok) straight = start === 1 ? 5 : start;
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : b[0] - a[0]));
  const g = (i: number) => groups[i];
  if (flush && straight) return { category: 8, values: [straight] };
  if (g(0)?.[1] === 4) return { category: 7, values: [g(0)![0], g(1)![0]] };
  if (g(0)?.[1] === 3 && g(1)?.[1] === 2) return { category: 6, values: [g(0)![0], g(1)![0]] };
  if (flush) return { category: 5, values: [...ranks] };
  if (straight) return { category: 4, values: [straight] };
  const singles = groups.filter((x) => x[1] === 1).map((x) => x[0]).sort((a, b) => b - a);
  if (g(0)?.[1] === 3) return { category: 3, values: [g(0)![0], ...singles] };
  if (g(0)?.[1] === 2 && g(1)?.[1] === 2) {
    return { category: 2, values: [Math.max(g(0)![0], g(1)![0]), Math.min(g(0)![0], g(1)![0]), groups.find((x) => x[1] === 1)?.[0] ?? 0] };
  }
  if (g(0)?.[1] === 2) return { category: 1, values: [g(0)![0], ...singles] };
  return { category: 0, values: [...ranks] };
}
function refBest(cards: number[]): HandRank {
  let best: HandRank | null = null;
  const n = cards.length;
  for (let a = 0; a < n - 4; a += 1)
    for (let b = a + 1; b < n - 3; b += 1)
      for (let c = b + 1; c < n - 2; c += 1)
        for (let d = c + 1; d < n - 1; d += 1)
          for (let e = d + 1; e < n; e += 1) {
            const cur = refFive([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (best === null || compareRanks(cur, best) > 0) best = cur;
          }
  return best!;
}

describe('evaluator — S8 characterization (current backend behaviour, 7/7)', () => {
  const ev = (s: string) => evaluate7(hand(s));
  const cmp = (a: string, b: string) => compareRanks(ev(a), ev(b));
  it('S8-1 wheel straight = 5-high', () => expect(ev('AS 2D 3C 4H 5S KD QC')).toEqual({ category: 4, values: [5] }));
  it('S8-2 steel wheel = straight flush 5', () => expect(ev('AS 2S 3S 4S 5S KD QC')).toEqual({ category: 8, values: [5] }));
  it('S8-3 6-high straight beats wheel', () => expect(cmp('2S 3D 4C 5H 6S KD QC', 'AS 2D 3C 4H 5S KD QC')).toBe(1));
  it('S8-4 flush kicker decides', () => expect(cmp('AH 9H 7H 5H 3H 2C 2D', 'AH 9H 7H 5H 2H 3C 3D')).toBe(1));
  it('S8-5 two trips -> full house AAA-KK', () => expect(ev('AS AD AC KH KS KD 2C')).toEqual({ category: 6, values: [14, 13] }));
  it('S8-6 three pairs -> best two pair + kicker', () => expect(ev('AS AD KC KH QS QD 2C')).toEqual({ category: 2, values: [14, 13, 12] }));
  it('S8-7 board plays (split)', () => expect(cmp('2S 3D AH KH QH JH TH', '4S 5D AH KH QH JH TH')).toBe(0));
});

describe('evaluator — equivalence with the 21-subset reference', () => {
  it('matches the reference on 30,000 random 7-card hands and 5,000 each of 5 and 6 cards', () => {
    const rng = createSeededRng('evaluator-equivalence');
    for (const [size, n] of [[7, 30000], [6, 5000], [5, 5000]] as const) {
      for (let k = 0; k < n; k += 1) {
        const cards = shuffledDeck(rng).slice(0, size);
        expect(evaluateIndices(cards)).toEqual(refBest(cards));
      }
    }
  });

  it('covers every category at least once in the sample', () => {
    const rng = createSeededRng('evaluator-categories');
    const seen = new Set<number>();
    for (let k = 0; k < 200000 && seen.size < 9; k += 1) seen.add(evaluateIndices(shuffledDeck(rng).slice(0, 7)).category);
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('evaluator — labels, best five, errors', () => {
  it('rankLabel maps the 9 categories to RankCode', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((category) => rankLabel({ category, values: [] }))).toEqual([
      'high_card', 'pair', 'two_pair', 'trips', 'straight', 'flush', 'full_house', 'quads', 'straight_flush',
    ]);
    expect(() => rankLabel({ category: 9, values: [] })).toThrow(RangeError);
  });

  it('bestFive returns a subset with the same rank, groups first, wheel ace last', () => {
    const idx = hand('QS QD QH AD 9C 2S 3H').map(cardIndex);
    expect(bestFiveIndices(idx).map(cardString)).toEqual(['Qs', 'Qh', 'Qd', 'Ad', '9c']);
    const wheel = hand('AS 2D 3C 4H 5S KD QC').map(cardIndex);
    expect(bestFiveIndices(wheel).map(cardString)).toEqual(['5s', '4h', '3c', '2d', 'As']);
    const rng = createSeededRng('best5');
    for (let k = 0; k < 2000; k += 1) {
      const cards = shuffledDeck(rng).slice(0, 7);
      const five = bestFiveIndices(cards);
      expect(five).toHaveLength(5);
      expect(five.every((c) => cards.includes(c))).toBe(true);
      expect(compareRanks(evaluateIndices(five), evaluateIndices(cards))).toBe(0);
    }
  });

  it('rejects invalid card strings and sizes', () => {
    expect(() => evaluate7(['AS' as Card, '2d', '3c', '4h', '5s'])).toThrow(TypeError);
    expect(() => evaluate7(['2d', '3c', '4h', '5s'])).toThrow(RangeError);
  });
});

describe('positions (D-P5, current labels)', () => {
  it('heads-up and full ring labels clockwise from the button', () => {
    expect(positionLabels([1, 2], 1)).toEqual({ 1: 'BTN/SB', 2: 'BB' });
    expect(positionLabels([1, 2, 3], 1)).toEqual({ 1: 'BTN', 2: 'SB', 3: 'BB' });
    expect(positionLabels([0, 1, 2, 3, 4, 5], 4)).toEqual({ 4: 'BTN', 5: 'SB', 0: 'BB', 1: 'UTG', 2: 'UTG+1', 3: 'UTG+2' });
    expect(positionLabels([5, 0, 3], 3)).toEqual({ 3: 'BTN', 5: 'SB', 0: 'BB' });
    expect(() => positionLabels([0, 1], 2)).toThrow(RangeError);
  });
});

describe('deck and rng', () => {
  it('shuffledDeck is a permutation of 0..51 and seeded runs repeat', () => {
    const a = shuffledDeck(createSeededRng(7));
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 52 }, (_, i) => i));
    expect(shuffledDeck(createSeededRng(7))).toEqual(a);
    expect(shuffledDeck(createSeededRng(8))).not.toEqual(a);
  });

  it('randomInt stays in range and is roughly uniform (chi-square over 6 buckets)', () => {
    const rng = createSeededRng('uniform');
    const counts = [0, 0, 0, 0, 0, 0];
    const n = 60000;
    for (let i = 0; i < n; i += 1) counts[randomInt(rng, 6)]! += 1;
    const chi = counts.reduce((s, c) => s + (c - n / 6) ** 2 / (n / 6), 0);
    expect(chi).toBeLessThan(20.5); // p ≈ 0.001 for 5 degrees of freedom
    expect(() => randomInt(rng, 0)).toThrow(RangeError);
  });
});

describe('evaluator throughput (micro-benchmark, printed for analysis MC budgeting)', () => {
  it('evaluate7 (string cards) and evaluateIndices (int path) per second', () => {
    const rng = createSeededRng('bench');
    const pool = Array.from({ length: 2000 }, () => shuffledDeck(rng).slice(0, 7));
    const strPool = pool.map((h) => h.map(cardString));
    const N = 200000;
    let t = Date.now();
    for (let i = 0; i < N; i += 1) evaluateIndices(pool[i % pool.length]!);
    const intMs = Date.now() - t;
    t = Date.now();
    for (let i = 0; i < N; i += 1) evaluate7(strPool[i % strPool.length]!);
    const strMs = Date.now() - t;
    const perSec = (ms: number) => Math.round(N / (Math.max(ms, 1) / 1000));
    testLog(`[bench] evaluateIndices ${perSec(intMs)}/s (${intMs} ms for ${N}) · evaluate7 ${perSec(strMs)}/s (${strMs} ms for ${N})`);
    expect(intMs).toBeGreaterThanOrEqual(0);
  });
});

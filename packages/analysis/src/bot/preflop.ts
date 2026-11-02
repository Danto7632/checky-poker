// Preflop hand selection for the rule bot: the 169 starting-hand classes ranked best to worst.
//
// How the table is made (SS14 asks the method to be written down): every class gets its Chen formula score
// (Bill Chen's published hand-strength heuristic), a deterministic integer computed from the two ranks only:
//   1. highest card: A 10, K 8, Q 7, J 6, T..2 = rank / 2      2. pair: double it, at least 5
//   3. suited +2                                               4. gap between ranks: 0, -1, -2, -4, then -5
//   5. +1 when the gap is 0 or 1 and both cards are below a queen   6. halves round up
// Ties are broken by: pair first, then higher top card, higher second card, suited before offsuit. A style plays
// "the top x%" of hands, where x is counted in card combos (pair 6, suited 4, offsuit 12; 1,326 in all).
//
// ponytail: Chen ordering is coarse (many equal scores, multiway value of small pairs ignored); if style tuning
// (3-2 arena, user feedback) needs finer ordering, replace the score with a heads-up all-in equity table made by
// the engine evaluator offline and committed as data.
import { CARD_RANKS, type Card } from '@checky/engine/protocol';

const RANKS_HIGH_FIRST = [...CARD_RANKS].reverse(); // A K Q ... 2

function chenHigh(rank: number): number {
  // rank: 2..14
  if (rank === 14) return 10;
  if (rank === 13) return 8;
  if (rank === 12) return 7;
  if (rank === 11) return 6;
  return rank / 2;
}

export function chenScore(high: number, low: number, suited: boolean): number {
  if (high === low) return Math.max(5, Math.ceil(chenHigh(high) * 2));
  let s = chenHigh(high) + (suited ? 2 : 0);
  const gap = high - low - 1;
  s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && high < 12) s += 1;
  return Math.ceil(s);
}

interface HandClass {
  name: string; // 'AA', 'AKs', 'T9o'
  combos: number;
  score: number;
  high: number;
  low: number;
  suited: boolean;
}

function buildClasses(): HandClass[] {
  const out: HandClass[] = [];
  for (let i = 0; i < 13; i += 1) {
    for (let j = i; j < 13; j += 1) {
      const high = 14 - i;
      const low = 14 - j;
      const hi = RANKS_HIGH_FIRST[i]!;
      const lo = RANKS_HIGH_FIRST[j]!;
      if (i === j) out.push({ name: `${hi}${lo}`, combos: 6, score: chenScore(high, low, false), high, low, suited: false });
      else {
        out.push({ name: `${hi}${lo}s`, combos: 4, score: chenScore(high, low, true), high, low, suited: true });
        out.push({ name: `${hi}${lo}o`, combos: 12, score: chenScore(high, low, false), high, low, suited: false });
      }
    }
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.high === b.low) - Number(a.high === a.low) ||
      b.high - a.high ||
      b.low - a.low ||
      Number(b.suited) - Number(a.suited),
  );
}

/** The 169 classes, best first. */
export const PREFLOP_ORDER: readonly string[] = buildClasses().map((c) => c.name);

// Cumulative combo share up to and including each class: 'AA' = 6/1326, the last class = 1.
const PERCENTILE = new Map<string, number>();
{
  let acc = 0;
  for (const c of buildClasses()) {
    acc += c.combos;
    PERCENTILE.set(c.name, acc / 1326);
  }
}

const rankValue = (c: Card): number => CARD_RANKS.indexOf(c[0] as (typeof CARD_RANKS)[number]) + 2;

export function handClass(a: Card, b: Card): string {
  const [x, y] = rankValue(a) >= rankValue(b) ? [a, b] : [b, a];
  if (x[0] === y[0]) return `${x[0]}${y[0]}`;
  return `${x[0]}${y[0]}${x[1] === y[1] ? 's' : 'o'}`;
}

/** Share of all 1,326 combos ranked at or above this hand (0 < p <= 1; smaller is stronger). */
export function preflopPercentile(a: Card, b: Card): number {
  const p = PERCENTILE.get(handClass(a, b));
  if (p === undefined) throw new Error('preflopPercentile: not a starting hand');
  return p;
}

// Equity vs N random hands (SS20, DV23): exact enumeration when it fits the budget, Monte Carlo otherwise.
//
// Definition: my two cards against `opponents` hands dealt uniformly from the remaining deck, the rest of the
// board dealt uniformly, k-way ties for the best hand split 1/k. Opponents' real cards are never used.
//
// Exact path (opponents <= 2). For every board completion the opponent holdings are ranked once against my hand
// and stored as a relation code; two opponents are then just pairs of disjoint holdings over that table, so the
// cost is evaluations (boards x holdings) plus cheap pair comparisons. Three or more opponents are never exact:
// even on the river that is 1.2e8 holding triples.
//
// Monte Carlo path. Each sample is a partial Fisher-Yates over the remaining deck with rejection-sampled indices
// (randomInt: no modulo bias) from the injected Rng. halfWidth95 = 1.96*sqrt(p(1-p)/n): outcomes lie in [0, 1]
// (ties are fractions), whose variance is at most p(1-p), so the binomial formula is a conservative bound.
//
// Hand ranking is the engine evaluator (A-ENG-EVAL); analysis must not carry its own (build-plan WR7).
import { compareRanks, evaluate7, type HandRank } from '@checky/engine';
import { CARD_RANKS, CARD_SUITS, type Card, type EquityMethod } from '@checky/engine/protocol';
import { randomInt, type Rng } from '@checky/engine/util';

/** DV23 needs n >= 9,604 for a 95% half-width <= 1%p at p = 0.5; 10,000 is the 1-2 default (api.analysis.v1). */
export const DISPLAY_SAMPLES = 10_000;
/**
 * Bot precision (A-ANL-METRICS budget): n >= 1,000, worst-case half-width 0.031. Not reduced for speed (D-S4).
 * Fixed at 1,000 by the lead (R0 review 3.2): bot decision p95 3.56-4.00 ms against the 50 ms target.
 */
export const N_BOT = 1_000;

/**
 * Exact-enumeration budgets in evaluate7-call units (exactCost). Bench 2026-11-01, Apple M3 Pro, Node 24.15
 * (rerun: test/perf.bench.test.ts "exact-enumeration cost", recorded in ml.md): evaluate7 ~0.47 us; exact river N<=2 <= 4 ms, turn N=1 33 ms (45,586 units),
 * turn N=2 89 ms (133,553 units), flop N=1 587 ms (1,071,271 units). Display (p95 <= 500 ms) stops below the
 * flop, leaving ~5x headroom for a slower laptop on turn N=2; bot (p95 <= 50 ms) keeps exact for the river only.
 */
export const DISPLAY_EXACT_LIMIT = 300_000;
export const BOT_EXACT_LIMIT = 10_000;
/** One evaluate7 call costs about this many pair visits of the two-opponent loop (turn N=2 bench: ~290). */
export const PAIRS_PER_EVAL = 256;

export interface EquityResult {
  value: number;
  method: EquityMethod;
  samples: number | null;
  halfWidth95: number | null;
  opponents: number;
}

const DECK: readonly Card[] = CARD_RANKS.flatMap((r) => CARD_SUITS.map((s): Card => `${r}${s}`));

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  for (let i = 0; i < k; i += 1) c = (c * (n - i)) / (i + 1);
  return Math.round(c);
}

/**
 * Work of the exact path in evaluate7-call units: boards x (1 + holdings) evaluations, plus for two opponents
 * every (holding, holding) pair visited, converted with PAIRS_PER_EVAL. Infinity when exact is not offered.
 */
export function exactCost(boardLen: number, opponents: number): number {
  if (opponents < 1 || opponents > 2) return Infinity;
  const remaining = 52 - 2 - boardLen;
  const toCome = 5 - boardLen;
  const boards = choose(remaining, toCome);
  const holdings = choose(remaining - toCome, 2);
  const evals = boards * (1 + holdings);
  return opponents === 1 ? evals : evals + (boards * choose(holdings, 2)) / PAIRS_PER_EVAL;
}

// Relation of an opponent holding to my hand on a complete board.
const OPP_LOSES = 0;
const OPP_TIES = 1;
const OPP_WINS = 2;

// Shares in sixths (1 = 6, 1/2 = 3, 1/3 = 2) so the exact sum is an integer and the value is one division
// (a float sum over 4e5 outcomes drifts by ~5e-13).
const SIXTHS = [6, 3, 2] as const;

function exactEquity(hole: readonly Card[], board: readonly Card[], deck: readonly Card[], opponents: number): number {
  const toCome = 5 - board.length;
  let total = 0;
  let count = 0;
  const pick: number[] = [];

  const scoreBoard = (full: readonly Card[]): void => {
    const mine: HandRank = evaluate7([...hole, ...full]);
    const rest = deck.filter((c) => !full.includes(c));
    const m = rest.length;
    // Holdings in (a, b) order with a < b; rel[h] = relation to me, cards[h] = [a, b] for the disjointness test.
    const rel: number[] = [];
    const ha: number[] = [];
    const hb: number[] = [];
    for (let a = 0; a < m; a += 1) {
      for (let b = a + 1; b < m; b += 1) {
        const c = compareRanks(evaluate7([rest[a]!, rest[b]!, ...full]), mine);
        rel.push(c > 0 ? OPP_WINS : c === 0 ? OPP_TIES : OPP_LOSES);
        ha.push(a);
        hb.push(b);
      }
    }
    if (opponents === 1) {
      for (const r of rel) total += r === OPP_LOSES ? 6 : r === OPP_TIES ? 3 : 0;
      count += rel.length;
      return;
    }
    // Two opponents: every unordered pair of disjoint holdings once (opponents are exchangeable).
    for (let i = 0; i < rel.length; i += 1) {
      const ri = rel[i]!;
      const a = ha[i]!;
      const b = hb[i]!;
      for (let j = i + 1; j < rel.length; j += 1) {
        const c = ha[j]!;
        const d = hb[j]!;
        if (c === a || c === b || d === a || d === b) continue;
        count += 1;
        const rj = rel[j]!;
        if (ri === OPP_WINS || rj === OPP_WINS) continue;
        total += SIXTHS[(ri === OPP_TIES ? 1 : 0) + (rj === OPP_TIES ? 1 : 0)]!;
      }
    }
  };

  // Board completions: combinations of `toCome` cards from the deck, in index order.
  const walk = (from: number): void => {
    if (pick.length === toCome) {
      scoreBoard([...board, ...pick.map((i) => deck[i]!)]);
      return;
    }
    for (let i = from; i <= deck.length - (toCome - pick.length); i += 1) {
      pick.push(i);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return total / (6 * count);
}

function monteCarlo(hole: readonly Card[], board: readonly Card[], deck: Card[], opponents: number, samples: number, rng: Rng): number {
  const toCome = 5 - board.length;
  const need = toCome + 2 * opponents;
  const n = deck.length;
  const full: Card[] = [...board];
  let total = 0;
  for (let s = 0; s < samples; s += 1) {
    for (let i = 0; i < need; i += 1) {
      const j = i + randomInt(rng, n - i);
      const t = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = t;
    }
    full.length = board.length;
    for (let i = 0; i < toCome; i += 1) full.push(deck[i]!);
    const mine = evaluate7([...hole, ...full]);
    let ties = 0;
    let lost = false;
    for (let k = 0; k < opponents; k += 1) {
      const at = toCome + 2 * k;
      const c = compareRanks(evaluate7([deck[at]!, deck[at + 1]!, ...full]), mine);
      if (c > 0) {
        lost = true; // one better hand is enough: my share is 0 whatever the others hold
        break;
      }
      if (c === 0) ties += 1;
    }
    if (!lost) total += 1 / (1 + ties);
  }
  return total / samples;
}

export function computeEquity(
  hole: readonly Card[],
  board: readonly Card[],
  opponents: number,
  opts: { samples: number; exactLimit: number; rng: Rng },
): EquityResult {
  const known = [...hole, ...board];
  if (hole.length !== 2 || board.length > 5 || board.length === 1 || board.length === 2) {
    throw new Error('computeEquity: 2 hole cards and a board of 0, 3, 4 or 5 cards');
  }
  if (new Set(known).size !== known.length) throw new Error('computeEquity: duplicate card');
  if (!Number.isInteger(opponents) || opponents < 1 || opponents > 5) throw new Error('computeEquity: 1..5 opponents');
  const deck = DECK.filter((c) => !known.includes(c));

  if (exactCost(board.length, opponents) <= opts.exactLimit) {
    return { value: exactEquity(hole, board, deck, opponents), method: 'exact', samples: null, halfWidth95: null, opponents };
  }
  const p = monteCarlo(hole, board, deck, opponents, opts.samples, opts.rng);
  return { value: p, method: 'mc', samples: opts.samples, halfWidth95: 1.96 * Math.sqrt((p * (1 - p)) / opts.samples), opponents };
}

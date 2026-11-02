// A-REC-RANK: language-free hand labels for app and share (AF-10, MA-R1-02). Both reuse the one evaluator.
//
//   rankCode(['As','Ah','Kd','Kc','2s'])   -> 'two_pair'
//   rankDetail(['As','Ah','Kd','Kc','2s']) -> {code: 'two_pair', ranks: ['A', 'K']}
//   rankDetail(['Ah','2c','3d','4s','5h']) -> {code: 'straight', ranks: ['5']}        (wheel)
//   fewer than 5 (or more than 7) cards     -> null
// `ranks` order/count per types.core.v1 RankDetail: the defining ranks only, never kickers. A royal flush is
// {code: 'straight_flush', ranks: ['A']} and the UI renders rank.royal_flush.
import { evaluate7, rankLabel, type HandRank } from '../cards/evaluator';
import { CARD_RANKS, type Card, type CardRank, type RankCode, type RankDetail } from '../protocol/view-types';

/** How many leading `values` define each category (the rest are kickers). */
const DEFINING: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 1, 4: 1, 5: 1, 6: 2, 7: 1, 8: 1 };

function evaluateOrNull(cards: readonly Card[]): HandRank | null {
  return cards.length < 5 || cards.length > 7 ? null : evaluate7(cards);
}

export function rankCode(cards: readonly Card[]): RankCode | null {
  const r = evaluateOrNull(cards);
  return r === null ? null : rankLabel(r);
}

export function rankDetail(cards: readonly Card[]): RankDetail | null {
  const r = evaluateOrNull(cards);
  if (r === null) return null;
  const ranks = r.values.slice(0, DEFINING[r.category]).map((v) => CARD_RANKS[v - 2] as CardRank);
  return { code: rankLabel(r), ranks };
}

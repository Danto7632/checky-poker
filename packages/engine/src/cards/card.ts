// Card representation. Inside the engine a card is an integer 0..51 = rankIndex * 4 + suitIndex, with
// rankIndex 0..12 for '2'..'A' (rank value = rankIndex + 2, so an ace is 14) and suitIndex 0..3 for s, h, d, c.
// Outside the engine cards are contract strings ('As', 'Td', '7c'). Integers keep the sealed hand state free of
// card-shaped text (ADR-0003 check 1) and make the evaluator allocation-light.
import { CARD_RANKS, CARD_SUITS, type Card, type CardRank, type CardSuit } from '../protocol/view-types';

const CARD_RE = /^[2-9TJQKA][shdc]$/;

export function isCard(v: unknown): v is Card {
  return typeof v === 'string' && CARD_RE.test(v);
}

/** 'As' -> 50. Throws TypeError on anything that is not a contract card string. */
export function cardIndex(card: string): number {
  if (!isCard(card)) throw new TypeError('invalid card');
  return CARD_RANKS.indexOf(card[0] as CardRank) * 4 + CARD_SUITS.indexOf(card[1] as CardSuit);
}

/** 50 -> 'As'. Throws RangeError outside 0..51. */
export function cardString(index: number): Card {
  if (!Number.isInteger(index) || index < 0 || index > 51) throw new RangeError('card index out of range');
  return `${CARD_RANKS[index >> 2]!}${CARD_SUITS[index & 3]!}` as Card;
}

/** Rank value 2..14 of a card index. */
export function rankValue(index: number): number {
  return (index >> 2) + 2;
}

export function suitIndex(index: number): number {
  return index & 3;
}

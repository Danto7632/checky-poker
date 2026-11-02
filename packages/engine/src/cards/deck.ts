// Shuffle (R10): Fisher-Yates over 0..51 with an unbiased index from randomInt (rejection sampling).
// The Rng is injected — crypto-backed in the host Worker, seeded in tests and VITE_E2E builds.
import { randomInt, type Rng } from '../util/rng';

export function shuffledDeck(rng: Rng): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return deck;
}

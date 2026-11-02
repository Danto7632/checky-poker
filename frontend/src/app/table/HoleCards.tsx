// My two hole cards (components.md 3.6), tilted -4/+4 degrees (no tilt under reduced motion). The hand-rank line
// under them needs rankDetail (MA-R1-02), which the engine provides later (Phillip, day 11 morning): until then the
// line is not drawn at all — the app does not re-implement the evaluator (ui-spec 0.6 "no code -> no line").
import type { Card } from '@checky/engine/protocol';
import { PlayingCard } from '../cards/PlayingCard';

export function HoleCards({ cards }: { cards: readonly [Card, Card] }) {
  return (
    <div className="flex gap-1" data-testid="T-01.holeCards">
      <PlayingCard card={cards[0]} size="hole" className="-rotate-4 motion-reduce:rotate-0" />
      <PlayingCard card={cards[1]} size="hole" className="rotate-4 motion-reduce:rotate-0" />
    </div>
  );
}

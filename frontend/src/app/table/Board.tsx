// Board (components.md 3.6): five fixed slots, dealt cards face up, the rest empty. One group label lists the cards
// (board.label) or says there are none yet (board.empty); individual empty slots are hidden from assistive tech.
import type { Card } from '@checky/engine/protocol';
import { PlayingCard, useCardLabel } from '../cards/PlayingCard';
import { useT } from '../i18n/useT';

export function Board({ cards }: { cards: readonly Card[] }) {
  const t = useT();
  const label = useCardLabel();
  const groupLabel = cards.length === 0 ? t('board.empty') : t('board.label', { cards: cards.map(label).join(t('common.listSep')) });
  return (
    <div role="group" aria-label={groupLabel} className="flex gap-1.5 md:gap-2" data-testid="T-01.board">
      {[0, 1, 2, 3, 4].map((i) => {
        const card = cards[i];
        return card === undefined ? <PlayingCard key={i} size="board" state="empty-slot" /> : <PlayingCard key={i} card={card} size="board" />;
      })}
    </div>
  );
}

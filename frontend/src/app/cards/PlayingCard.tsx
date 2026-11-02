// PlayingCard (components.md 2.1). Card = contract string ("As", "Td"); no card = face down.
//
// Sizes come from tokens (--card-*, --board-card-*, --mini-card-*; tokens.css shrinks them below 768 px) and the
// rank glyph scales with the card width, so a token change resizes everything consistently. role="img" with a
// localized label ("Ace of spades" / 「スペードのA」); the face-down card reads card.back. `win` lifts the card 4 px
// (data-motion="move" removes the lift under reduced motion).
import { useCallback } from 'react';
import { clsx } from 'clsx';
import type { Card } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { parseCard } from '../table/format';
import { CardBack } from './CardBack';
import { SuitGlyph } from './SuitGlyph';

export type CardSize = 'hole' | 'board' | 'mini';
export type CardState = 'default' | 'dim' | 'win' | 'empty-slot';

const BOX: Record<CardSize, string> = {
  hole: 'w-(--card-w) h-(--card-h)',
  board: 'w-(--board-card-w) h-(--board-card-h)',
  mini: 'w-(--mini-card-w) h-(--mini-card-h)',
};
const RANK_TEXT: Record<CardSize, string> = {
  hole: 'text-[length:calc(var(--card-w)*0.34)]',
  board: 'text-[length:calc(var(--board-card-w)*0.33)]',
  mini: 'text-[length:calc(var(--mini-card-w)*0.39)]',
};

export function useCardLabel(): (card: Card) => string {
  const { t, td } = useI18n();
  return useCallback(
    (card: Card) => {
      const { rank, suit } = parseCard(card);
      return t('card.label', { rank: td(`rank.r.${rank}`), suit: td(`card.suit.${suit}`) });
    },
    [t, td],
  );
}

export interface PlayingCardProps {
  card?: Card | null | undefined;
  size: CardSize;
  state?: CardState;
  className?: string;
}

export function PlayingCard({ card, size, state = 'default', className }: PlayingCardProps) {
  const { t } = useI18n();
  const label = useCardLabel();
  if (state === 'empty-slot') {
    return <span aria-hidden="true" className={clsx(BOX[size], 'block rounded-card border border-dashed border-rail-highlight', className)} />;
  }
  if (card === undefined || card === null) {
    return (
      <span role="img" aria-label={t('card.back')} className={clsx(BOX[size], 'inline-block', className)}>
        <CardBack className="size-full" />
      </span>
    );
  }
  const { suit, face, red } = parseCard(card);
  return (
    <span
      role="img"
      aria-label={label(card)}
      data-motion="move"
      className={clsx(
        BOX[size],
        'relative inline-flex flex-col rounded-card border border-card-edge bg-card-face p-1 leading-tight font-display font-extrabold transition-transform motion-transition select-none',
        red ? 'text-suit-red' : 'text-suit-black',
        state === 'dim' && 'opacity-45 grayscale',
        state === 'win' && '-translate-y-1 ring-2 ring-good',
        className,
      )}
    >
      <span aria-hidden="true" className={RANK_TEXT[size]}>
        {face}
      </span>
      <SuitGlyph suit={suit} className={size === 'mini' ? 'size-3' : 'size-3.5'} />
      {size !== 'mini' ? <SuitGlyph suit={suit} className="absolute right-1 bottom-1 size-1/2" /> : null}
    </span>
  );
}

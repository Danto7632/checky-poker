// Suit glyphs as SVG paths (components.md 2.2). Unicode suit characters can turn into emoji on iOS, so suits are
// always drawn. Colour comes from currentColor (the card face sets --suit-red / --suit-black).
import type { ReactElement } from 'react';
import type { CardSuit } from '@checky/engine/protocol';

const PATHS: Record<CardSuit, ReactElement> = {
  s: <path d="M16 3C10 10 4 14 4 19c0 4 3 6 6 6 2 0 4-1 5-3-1 3-2 5-4 7h10c-2-2-3-4-4-7 1 2 3 3 5 3 3 0 6-2 6-6 0-5-6-9-12-16z" />,
  h: <path d="M16 28C4 19 2 12 6 8c3-3 8-2 10 2 2-4 7-5 10-2 4 4 2 11-10 20z" />,
  d: <path d="M16 2L28 16 16 30 4 16z" />,
  c: (
    <>
      <circle cx="16" cy="9" r="6" />
      <circle cx="9" cy="18" r="6" />
      <circle cx="23" cy="18" r="6" />
      <path d="M14 18h4l3 11H11z" />
    </>
  ),
};

export function SuitGlyph({ suit, className }: { suit: CardSuit; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="currentColor" className={className}>
      {PATHS[suit]}
    </svg>
  );
}

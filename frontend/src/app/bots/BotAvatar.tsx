// Bot avatar (components.md section 6), house variant: rounded square in the seat colour with "H". A rounded
// square (not a circle like people) lets players tell bots apart without relying on colour (WCAG 1.4.1).
// AI variants (provider letters, the "AI" mini tag) are added by 3-3.
import { clsx } from 'clsx';
import { seatColourIndex } from '../ui/Avatar';

const SEAT_BG = ['bg-seat-1', 'bg-seat-2', 'bg-seat-3', 'bg-seat-4', 'bg-seat-5', 'bg-seat-6'] as const;
const SIZE = { 48: 'size-12 text-title-sm', 40: 'size-10 text-body', 32: 'size-8 text-small', 20: 'size-5 text-micro' } as const;

export function BotAvatar({ seat, size, className }: { seat: number; size: keyof typeof SIZE; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('inline-flex shrink-0 items-center justify-center rounded-md font-display font-extrabold text-background', SEAT_BG[seatColourIndex(seat, seat)], SIZE[size], className)}
    >
      H
    </span>
  );
}

// Avatar for people (components.md 1.16, US2 AC4): a local SVG circle in a seat colour with the first letter of
// the name — no image request, no third-party service (the old dicebear avatars are gone).
//
// Colour: the seat colour when the person has a seat (--seat-{seat+1}); otherwise avatarSeed % 6 (profile screens).
// Bots use bots/BotAvatar (rounded square) so the two are told apart by shape, not colour (WCAG 1.4.1).
import { clsx } from 'clsx';

export interface AvatarProps {
  name: string;
  seed: number;
  seat?: number | null | undefined;
  size: 64 | 48 | 40 | 32;
  className?: string;
}

const SEAT_FILL = ['fill-seat-1', 'fill-seat-2', 'fill-seat-3', 'fill-seat-4', 'fill-seat-5', 'fill-seat-6'] as const;

export function seatColourIndex(seed: number, seat: number | null | undefined): number {
  const base = seat ?? seed;
  return ((Math.trunc(base) % 6) + 6) % 6;
}

/** First user-perceived letter, uppercased. Uses code points so an emoji or a surrogate pair is not split. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0];
  return first === undefined ? '?' : first.toLocaleUpperCase();
}

/** Seed for "Shuffle avatar" (P-01, S-01). Purely cosmetic, never security relevant. */
export function randomAvatarSeed(): number {
  // eslint-disable-next-line no-restricted-properties -- avatar flourish only (project-context section 6 exception)
  return Math.floor(Math.random() * 2 ** 31);
}

export function Avatar({ name, seed, seat, size, className }: AvatarProps) {
  const fontSize = size * 0.45;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={clsx('shrink-0', className)}
    >
      <circle cx={size / 2} cy={size / 2} r={size / 2} className={SEAT_FILL[seatColourIndex(seed, seat)]} />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fontSize}
        className="fill-background font-display font-extrabold"
      >
        {initialOf(name)}
      </text>
    </svg>
  );
}

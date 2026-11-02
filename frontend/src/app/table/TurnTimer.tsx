// TurnTimer (components.md 3.5): a ring around the avatar for the seat whose turn it is. turn === null renders
// nothing at all — no ring, no number, no announcement (practice No limit, rule bots, nobody to act).
// Colours: mine --accent / others --text, <= 10 s --warn, <= 5 s --critical; the seconds badge appears from 10 s.
// Under reduced motion the ring is hidden and only the number shows (1 s steps).
import { clsx } from 'clsx';
import type { TurnClock } from './format';
import { secondsOf, useCountdown } from './useCountdown';

export interface TurnTimerProps {
  turn: TurnClock | null;
  mine: boolean;
  /** Changes whenever a new turn starts (hand id + turnSeq), so the local clock re-syncs. */
  turnKey: string;
  frozen?: boolean;
}

export function TurnTimer({ turn, mine, turnKey, frozen = false }: TurnTimerProps) {
  const left = useCountdown(turn?.remainingMs ?? null, turnKey, frozen);
  if (turn === null || left === null) return null;
  const s = secondsOf(left);
  const fraction = Math.max(0, Math.min(1, left / turn.totalMs));
  const tone = s <= 5 ? 'stroke-critical text-critical' : s <= 10 ? 'stroke-warn text-warn' : mine ? 'stroke-primary text-primary' : 'stroke-foreground text-foreground';
  return (
    <span className="pointer-events-none absolute -inset-1" data-testid="T-01.turnTimer">
      <svg aria-hidden="true" viewBox="0 0 36 36" className="size-full -rotate-90 motion-reduce:hidden">
        <circle cx="18" cy="18" r="16.5" fill="none" strokeWidth="3" className="stroke-border" />
        <circle
          cx="18"
          cy="18"
          r="16.5"
          fill="none"
          strokeWidth="3"
          pathLength={1}
          strokeDasharray={`${fraction} 1`}
          className={clsx('transition-[stroke] motion-transition', tone)}
        />
      </svg>
      {/* Seconds badge from 10 s; always visible under reduced motion, where it replaces the ring. */}
      <span
        aria-hidden="true"
        className={clsx('num absolute -top-2 -right-2 rounded-pill bg-raised px-1.5 text-micro font-semibold', tone, s <= 10 ? 'inline' : 'hidden motion-reduce:inline')}
      >
        {s}
      </span>
    </span>
  );
}

// Badge / Tag (components.md 1.12): 20 px, --r-xs, micro 600. Tone = *-soft background + same-colour text
// (composited contrast >= 4.8). `caps` uses .label-caps (uppercase in en, none in ja via :lang(ja)); equity badges
// pass caps={false} because "Estimate ±2.4%" reads badly in capitals.
import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warn' | 'critical' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'border border-border-strong text-muted-foreground',
  accent: 'bg-primary-soft text-primary',
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  critical: 'bg-critical-soft text-critical',
  info: 'bg-info-soft text-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  caps?: boolean;
  /** Sentence-length chips (G-01 destination) may wrap instead of overflowing on narrow screens. */
  wrap?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', caps = true, wrap = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={clsx(
        'inline-flex items-center rounded-xs px-1.5 text-micro font-semibold',
        wrap ? 'min-h-5 py-0.5' : 'h-5 whitespace-nowrap',
        caps && 'label-caps',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

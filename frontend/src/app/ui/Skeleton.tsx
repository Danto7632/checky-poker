// Skeleton (components.md 1.14): --ink-800 block with a 1.2 s opacity shimmer that stops under reduced motion.
// First loads only (seat placeholders, lists); never for per-turn recalculation (LiveOdds uses "—").
import { clsx } from 'clsx';

export function Skeleton({ className, round = false }: { className?: string; round?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx('block bg-input motion-shimmer motion-reduce:animate-none', round ? 'rounded-pill' : 'rounded-md', className)}
    />
  );
}

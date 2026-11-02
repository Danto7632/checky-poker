// Local countdown for values the contract sends as "remaining ms at send time" (turnMs, countdownMs): count down from
// the moment the value arrived and re-sync whenever a new value (or key) comes in. `frozen` stops it in place —
// a paused room keeps the number it stopped at instead of pretending to count (motion-spec M-PAUSE).
// The count remembers the value and key it was counted from. In the render where a new value or key arrives (before
// the effect re-syncs) the new value is returned, never the last count of the previous turn: a stale "3 s" would
// otherwise reach the 5-second warning of a fresh 60 s turn (TableAnnouncer, R0-L26) and flash in the timers.
import { useEffect, useState } from 'react';

const TICK_MS = 250;

export function useCountdown(remainingMs: number | null, key: string, frozen = false): number | null {
  const [count, setCount] = useState({ from: remainingMs, key, left: remainingMs });
  useEffect(() => {
    setCount((c) => (c.from === remainingMs && c.key === key && c.left === remainingMs ? c : { from: remainingMs, key, left: remainingMs }));
    if (remainingMs === null || frozen) return undefined;
    const start = Date.now();
    const id = setInterval(() => setCount({ from: remainingMs, key, left: Math.max(0, remainingMs - (Date.now() - start)) }), TICK_MS);
    return () => clearInterval(id);
  }, [remainingMs, key, frozen]);
  return count.from === remainingMs && count.key === key ? count.left : remainingMs;
}

/** Whole seconds for display: 23.2 s left reads "24" until it really drops below 24 (ceil, like a kitchen timer). */
export function secondsOf(ms: number): number {
  return Math.ceil(ms / 1000);
}

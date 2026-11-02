// Console and monotonic clock for analysis tests. The package compiles with `types: []` and no DOM lib so that
// src cannot reach timers, crypto or the console; declaring those globals would loosen src too, so tests read
// them off globalThis here instead (Node and Vitest always provide both).
const g = globalThis as unknown as { console: { log(...args: unknown[]): void }; performance: { now(): number } };

export const log = (...args: unknown[]): void => g.console.log(...args);
export const nowMs = (): number => g.performance.now();

/** Runtime line for bench output (CPU model is recorded by hand in ml.md: Node has no portable API without os). */
export function runtime(): string {
  const nav = (globalThis as unknown as { navigator?: { userAgent?: string; hardwareConcurrency?: number } }).navigator;
  return `${nav?.userAgent ?? 'unknown runtime'}, ${nav?.hardwareConcurrency ?? '?'} threads`;
}

// Test-only logger and bench switch. The engine tsconfig has lib ES2023 and types [] (no DOM, no Node), so
// `console` and `process` have no type here; benchmarks reach them through globalThis.
const sink = (globalThis as { console?: { log(...args: unknown[]): void } }).console;

export function testLog(...args: unknown[]): void {
  sink?.log(...args);
}

/**
 * Wall-clock bounds are asserted only with CHECKY_BENCH=1 (R0 m1): in the default suite a loaded runner would
 * fail them for reasons unrelated to the code. The numbers are printed either way.
 */
export const ASSERT_BENCH = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CHECKY_BENCH === '1';

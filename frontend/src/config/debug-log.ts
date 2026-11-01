import type { ErrorCode, NoticeCode } from './contract-codes';
import { defaults } from './defaults';

// Connection stages and streets are closed here because config must not import engine. A 1-1 test checks that
// these literals equal the engine's ConnStage / Street sets.
export type ConnStageLit =
  | 'idle'
  | 'opening_room'
  | 'finding_room'
  | 'connecting_host'
  | 'taking_seat'
  | 'ready'
  | 'reconnecting'
  | 'host_lost'
  | 'closed'
  | 'failed';

export type StreetLit = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'RUNOUT' | 'SHOWDOWN' | 'COMPLETE' | 'VOIDED';

// A finite literal union on purpose. A prefix template type such as `E-${string}` would let a card or a nickname
// reach the code position through string concatenation (T-004).
export type DebugCode = ErrorCode | NoticeCode | `stage:${ConnStageLit}`;

// Numbers and enum literals only: keys, rpk, room codes, nicknames, IPs and cards cannot be passed.
export type DebugValue = number | boolean | ConnStageLit | StreetLit;

export type DebugData = Readonly<Record<string, DebugValue>>;

export interface DebugEntry {
  readonly code: DebugCode;
  readonly data: DebugData | null;
  /** performance.now() (monotonic in the main thread and in Workers). */
  readonly atMs: number;
}

const ring: DebugEntry[] = [];

export function debugLog(code: DebugCode, data?: DebugData): void {
  ring.push({ code, data: data === undefined ? null : { ...data }, atMs: performance.now() });
  while (ring.length > defaults.debugLogSize) ring.shift();
}

// Oldest first. Only "copy diagnostics" (R-04) reads this.
export function getDebugLog(): readonly DebugEntry[] {
  return ring.slice();
}

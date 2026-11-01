import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DebugCode } from './debug-log';

async function freshLog() {
  vi.resetModules();
  return import('./debug-log');
}

describe('debugLog ring buffer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('getDebugLog returns entries oldest first with order preserved (3 writes -> length 3)', async () => {
    const { debugLog, getDebugLog } = await freshLog();
    debugLog('E-NET-ICE-FAILED', { ms: 1200 });
    debugLog('stage:finding_room');
    debugLog('N-PAUSED');
    const log = getDebugLog();
    expect(log).toHaveLength(3);
    expect(log.map((e) => e.code)).toEqual(['E-NET-ICE-FAILED', 'stage:finding_room', 'N-PAUSED']);
    expect(log[0]?.data).toEqual({ ms: 1200 });
    expect(log[1]?.data).toBeNull();
    expect(log[0]?.atMs).toBeLessThanOrEqual(log[2]?.atMs ?? -1);
  });

  it('keeps at most 500 entries and drops the oldest first (the 501st write drops entry 0)', async () => {
    const { debugLog, getDebugLog } = await freshLog();
    for (let i = 0; i < 500; i++) debugLog('N-PAUSED', { i });
    expect(getDebugLog()).toHaveLength(500);
    expect(getDebugLog()[0]?.data).toEqual({ i: 0 });
    debugLog('N-RESUMED', { i: 500 });
    const log = getDebugLog();
    expect(log).toHaveLength(500);
    expect(log[0]?.data).toEqual({ i: 1 });
    expect(log[499]?.data).toEqual({ i: 500 });
    expect(log[499]?.code).toBe('N-RESUMED');
  });

  it('does not let callers mutate stored data or the returned snapshot', async () => {
    const { debugLog, getDebugLog } = await freshLog();
    const data: Record<string, number> = { ms: 1 };
    debugLog('E-NET-ICE-FAILED', data);
    data.ms = 2;
    expect(getDebugLog()[0]?.data).toEqual({ ms: 1 });
    const snapshot = getDebugLog() as unknown[];
    snapshot.length = 0;
    expect(getDebugLog()).toHaveLength(1);
  });
});

// The type-level guarantees below are checked by `npm run typecheck`: an unused @ts-expect-error fails it.
describe('DebugCode / DebugValue types', () => {
  it('rejects codes and values that could carry private data', async () => {
    const { debugLog } = await freshLog();
    const s: string = String(Date.now());
    const roomCode: unknown = 'ABCDEFGHJK';
    const calls: Array<() => void> = [
      // @ts-expect-error a card is not a code
      () => debugLog('Ah'),
      // @ts-expect-error a made-up code
      () => debugLog('E-NOT-A-CODE'),
      // @ts-expect-error a code built from an arbitrary string
      () => debugLog('E-' + s),
      // @ts-expect-error a template literal type is still not the finite union
      () => debugLog(`E-${s}` as const),
      // @ts-expect-error a card in data
      () => debugLog('E-NET-ICE-FAILED', { card: 'Ah' }),
      // @ts-expect-error a room code in data
      () => debugLog('E-NET-ICE-FAILED', { code: roomCode as string }),
    ];
    expect(calls).toHaveLength(6);
    // Allowed forms compile and run.
    debugLog('E-NET-ICE-FAILED', { ms: 1200 });
    debugLog('stage:finding_room');
    const code: DebugCode = 'N-PAUSED';
    debugLog(code, { street: 'FLOP', online: true });
  });
});

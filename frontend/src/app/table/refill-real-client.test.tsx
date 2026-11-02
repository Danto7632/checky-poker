// R0-L15 (MS-R0-3 D6) on the REAL practice client: the bug only showed outside the fake scenarios. Busted, then
// "Get chips again": the very next view must make the screen say "You have 10,000 chips." in the bottom slot, my
// seat must read 10,000 (the table stack, not the finished hand's 0) and must not keep the "All-in" badge of the
// finished hand. Real path = `@/session` createPracticeClient -> tab host -> `new Worker` (stubbed with the real shell
// running in-process, as the session's own wiring test does) -> engine reducer + projection -> TableScreen.
// The deal is made deterministic with the shell's rng test seam and a small xorshift (app tests may not import
// @checky/engine/util); my policy is "all-in whenever it is my turn" until I am busted.
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BotSpec, RoomSettings, WorkerInbound } from '@checky/engine/protocol';
import { defaults } from '@/config';
import { createInProcessHostPort } from '@/host/testing';
import { createPracticeClient, type AppConfig, type PracticeTableClient } from '@/session';
import { renderI18n } from '../testing/render';
import { TableScreen } from './TableScreen';

/** xorshift32: enough to fix one deal sequence for this test. */
function xorshift(seed: number) {
  let x = seed >>> 0 || 1;
  return {
    nextUint32() {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return x;
    },
  };
}

/** `new Worker(url)` stand-in that runs the real dealer shell on this thread (structured-cloned, async delivery). */
class InProcessWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private readonly port = createInProcessHostPort({ clock: { nowMs: () => Date.now() }, rng: xorshift(20261102) });
  constructor() {
    this.port.onMessage((data) => this.onmessage?.({ data }));
  }
  postMessage(m: WorkerInbound): void {
    this.port.post(m);
  }
  terminate(): void {
    this.port.terminate();
  }
}

const SETTINGS: RoomSettings = { seatCount: 2, sb: 50, bb: 100, startStack: 10000, turnSeconds: 60, liveEquity: false, botChatter: false };
const BOT: BotSpec = { engine: 'rule', style: 'balanced', provider: null, model: null, label: 'House 1' };
const config: AppConfig = { defaults, APP_VERSION: 'test-sha', debugLog: vi.fn(), getE2EHooks: () => null };

function realClient(): PracticeTableClient {
  return createPracticeClient({
    settings: SETTINGS,
    bots: [BOT],
    profile: { nickname: 'Mina', avatarSeed: 5, lang: 'en', updatedAt: '2026-11-02T00:00:00.000Z' },
    deps: {
      hands: { put: () => Promise.resolve(), get: () => Promise.resolve(null), list: () => Promise.resolve({ items: [], next: null }), count: () => Promise.resolve(0) },
      device: { getSecret: vi.fn(), roomPlayerKey: vi.fn(), regenerate: vi.fn() },
      config,
    },
  });
}

/** Shove every turn until the client offers a refill (I am busted). */
async function playUntilBusted(client: PracticeTableClient): Promise<void> {
  let acted = '';
  for (let i = 0; i < 4000 && client.getSnapshot().view?.me.canRefill !== true; i += 1) {
    const v = client.getSnapshot().view;
    const key = `${v?.hand?.handId}:${v?.hand?.turnSeq}`;
    if (v?.me.legal && key !== acted) {
      acted = key;
      void client.act({ seat: v.me.seat!, type: 'allin', to: v.me.legal.allIn.to });
    }
    await vi.advanceTimersByTimeAsync(250);
  }
}

beforeAll(() => {
  vi.stubGlobal('Worker', InProcessWorker);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('refill on the real practice client (R0-L15, MS-R0-3 D6)', () => {
  it('busted -> "Get chips again" -> "You have 10,000 chips." right away; my seat reads 10,000 without "All-in"', async () => {
    vi.useFakeTimers();
    const client = realClient();
    await playUntilBusted(client);
    const busted = client.getSnapshot().view!;
    expect(busted.me.canRefill).toBe(true);
    expect(busted.seats.find((s) => s.occupant?.isMe)!.occupant!.stack).toBe(0);

    renderI18n(<TableScreen client={client} computeMetrics={undefined} liveOdds={false} onLiveOdds={vi.fn()} onLeave={vi.fn()} onRestart={vi.fn()} />);
    const mySeat = screen.getByTestId(`T-01.seat${busted.me.seat!}`);
    fireEvent.click(within(screen.getByTestId('T-01.slot')).getByTestId('T-06.refill'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1); // the Worker answers REFILL with the next view
    });

    // Still the same between-hands moment (no new hand dealt yet), and already confirmed.
    expect(client.getSnapshot().view!.hand?.handId).toBe(busted.hand?.handId);
    expect(screen.getByTestId('T-06.done').textContent).toBe('You have 10,000 chips.');
    expect(mySeat.getAttribute('aria-label')).toMatch(/, 10,000 chips/);
    expect(mySeat.getAttribute('aria-label')).not.toMatch(/All-in/);
    expect(within(mySeat).queryByText('All-in')).toBeNull();
    client.dispose();
  });
});

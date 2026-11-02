// R0-L12 (MS-R0-3 D1): one dealer Worker per tab, leased to one room at a time.
//   1. createSharedHost on a scripted fake port: spawn count, the W.DISPOSE/W.DISPOSED room boundary, revoke,
//      crash and W.FATAL handling (a crash resets the boundary, R0-L30), the 2000 ms W.DISPOSED watchdog (R0-L31,
//      fake timers) timed from the Worker's first message (R0-L34), prewarm's probe and its Promise<boolean>.
//   2. The public wiring (`@/session` prewarmPracticeHost + createPracticeClient over createHostWorker) with a
//      stubbed global Worker that runs the real shell in-process: this is the offline D1 path — after the first
//      spawn no table may construct a Worker again (constructing one = fetching its script). R0-L34 (fix3 review
//      W3): a Worker whose script loads slowly is not a crash.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BotSpec, RoomSettings, WorkerInbound } from '@checky/engine/protocol';
import { defaults } from '@/config';
import type { HostPort } from '@/host';
import { createInProcessHostPort } from '@/host/testing';
import { createSharedHost } from './shared-host';
import type { AppConfig, PracticeOptions } from './types';

interface FakePort extends HostPort {
  posted: unknown[];
  terminated: boolean;
  emit(msg: unknown): void;
  fireCrash(): void;
}

function fakePorts() {
  const ports: FakePort[] = [];
  const spawn = (): FakePort => {
    const messages = new Set<(m: unknown) => void>();
    const crashes = new Set<() => void>();
    const p: FakePort = {
      posted: [],
      terminated: false,
      post: (m) => void p.posted.push(m),
      onMessage: (l) => (messages.add(l), () => messages.delete(l)),
      onCrash: (l) => (crashes.add(l), () => crashes.delete(l)),
      terminate: () => void (p.terminated = true),
      emit: (m) => [...messages].forEach((l) => l(m)),
      fireCrash: () => [...crashes].forEach((l) => l()),
    };
    ports.push(p);
    return p;
  };
  return { ports, spawn };
}

const view = (tag: string) => ({ t: 'W.OUT', to: 'local', env: { tag } });
const INIT = { t: 'W.INIT', config: {}, host: null } as unknown as WorkerInbound & { t: 'W.INIT' };

/** 'pending' while `p` has not settled (a settled `p` wins the race: it is listed first). */
const settled = (p: Promise<boolean>): Promise<boolean | 'pending'> => Promise.race([p, Promise.resolve('pending' as const)]);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('createSharedHost (scripted port)', () => {
  it('prewarm spawns and probes once however often it is called; acquire reuses that Worker', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    host.prewarm();
    host.prewarm();
    host.prewarm();
    expect(ports).toHaveLength(1);
    const lease = host.acquire(() => undefined);
    lease.post(INIT);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.posted).toEqual([{ t: 'W.DISPOSE' }, INIT]); // the probe (R0-L34), then the room
  });

  it('prewarm resolves false (no throw, no rejection) when the spawn throws; acquire retries the spawn and throws to its caller', async () => {
    let fail = true;
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(() => {
      if (fail) throw new TypeError('Worker is not a constructor');
      return spawn();
    });
    await expect(host.prewarm()).resolves.toBe(false);
    expect(() => host.acquire(() => undefined)).toThrow(TypeError);
    fail = false;
    host.acquire(() => undefined).post(INIT);
    expect(ports).toHaveLength(1);
  });

  it('every message between a W.DISPOSE and its W.DISPOSED is dropped — counted, so two quick rooms still line up', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const got = { a: [] as unknown[], b: [] as unknown[], c: [] as unknown[] };
    const a = host.acquire(() => undefined);
    a.onMessage((m) => got.a.push(m));
    ports[0]!.emit(view('a1'));
    a.release();
    const b = host.acquire(() => undefined);
    b.onMessage((m) => got.b.push(m));
    b.release(); // the table closed before its first message arrived
    const c = host.acquire(() => undefined);
    c.onMessage((m) => got.c.push(m));
    const w = ports[0]!;
    w.emit(view('a-late')); // a's room, still in flight when a released
    w.emit({ t: 'W.OUT', to: 'local', env: { t: 'H.NACK', b: { c: 1 } } }); // would settle c's c=1 if it leaked
    w.emit({ t: 'W.DISPOSED' });
    w.emit(view('b1')); // b's room
    w.emit({ t: 'W.DISPOSED' });
    w.emit(view('c1'));
    expect(got).toEqual({ a: [view('a1')], b: [], c: [view('c1')] });
    expect(w.posted.filter((m) => (m as { t: string }).t === 'W.DISPOSE')).toHaveLength(2);
    expect(ports).toHaveLength(1);
    expect(w.terminated).toBe(false);
  });

  it('release is idempotent and a released lease cannot post into the next room', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    a.release();
    a.release();
    host.acquire(() => undefined);
    a.post(INIT);
    expect(ports[0]!.posted).toEqual([{ t: 'W.DISPOSE' }]);
  });

  it('acquiring while a room still holds the Worker releases that room first, then calls its revoke', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const order: string[] = [];
    const a = host.acquire(() => order.push(`revoke after ${ports[0]!.posted.length} post(s)`));
    a.post(INIT);
    host.acquire(() => undefined);
    expect(order).toEqual(['revoke after 2 post(s)']);
    expect(ports[0]!.posted).toEqual([INIT, { t: 'W.DISPOSE' }]);
  });

  it('a crash terminates and forgets the Worker: the live room hears onCrash, the next acquire spawns a fresh one', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    const crashed = vi.fn();
    a.onCrash(crashed);
    ports[0]!.fireCrash();
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(ports[0]!.terminated).toBe(true);
    a.release(); // nothing to give back: no W.DISPOSE to a dead Worker
    expect(ports[0]!.posted).toEqual([]);
    host.acquire(() => undefined).post(INIT);
    expect(ports).toHaveLength(2);
    expect(ports[1]!.posted).toEqual([INIT]);
    // A crash with no room open just forgets the Worker.
    host.prewarm();
    ports[1]!.fireCrash();
    host.prewarm();
    expect(ports).toHaveLength(3);
  });

  it('W.FATAL: the live room gets the message, then the Worker is terminated (never reused)', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    const seen: unknown[] = [];
    a.onMessage((m) => seen.push(m));
    ports[0]!.emit({ t: 'W.FATAL', code: 'E-ENG-INVALID-INIT' });
    expect(seen).toEqual([{ t: 'W.FATAL', code: 'E-ENG-INVALID-INIT' }]);
    expect(ports[0]!.terminated).toBe(true);
    host.acquire(() => undefined);
    expect(ports).toHaveLength(2);
  });

  it('W.FATAL of a disposed room reaches the next room as a crash (the stopped Worker ignored its W.INIT)', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    host.acquire(() => undefined).release();
    const b = host.acquire(() => undefined);
    const seen: unknown[] = [];
    const crashed = vi.fn();
    b.onMessage((m) => seen.push(m));
    b.onCrash(crashed);
    ports[0]!.emit({ t: 'W.FATAL', code: 'E-WORKER-CRASH' });
    expect(seen).toEqual([]);
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(ports[0]!.terminated).toBe(true);
  });

  // R0-L30 (fix2 review F1): the room boundary belongs to the Worker. A crash that leaves a W.DISPOSE unanswered must
  // forget it with the Worker; otherwise every message of the fresh Worker looks like the disposed room's and the
  // next table stays blank forever, with no error.
  const KILLS = [
    { name: 'error event', kill: (p: FakePort) => p.fireCrash() },
    { name: 'W.FATAL of the disposed room', kill: (p: FakePort) => p.emit({ t: 'W.FATAL', code: 'E-WORKER-CRASH' }) },
  ];
  for (const { name, kill } of KILLS) {
    for (const open of [false, true]) {
      it(`R0-L30: ${name} while a W.DISPOSED is outstanding (${open ? 'next room open' : 'no room open'}) -> the next room on the fresh Worker hears its own messages`, () => {
        vi.useFakeTimers();
        const { ports, spawn } = fakePorts();
        const host = createSharedHost(spawn);
        const first = host.acquire(() => undefined);
        ports[0]!.emit(view('a1')); // the Worker runs (R0-L34), so the W.DISPOSE below is on the clock
        first.release(); // W.DISPOSE out; its W.DISPOSED never comes back
        const crashed = vi.fn();
        if (open) host.acquire(() => undefined).onCrash(crashed);
        kill(ports[0]!);
        expect(ports[0]!.terminated).toBe(true);
        expect(crashed).toHaveBeenCalledTimes(open ? 1 : 0);
        const next = host.acquire(() => undefined);
        const seen: unknown[] = [];
        next.onMessage((m) => seen.push(m));
        next.post(INIT);
        ports[1]!.emit(view('n1'));
        expect(ports).toHaveLength(2);
        expect(ports[1]!.posted).toEqual([INIT]);
        expect(seen).toEqual([view('n1')]);
        // The dead Worker's watchdog went with it: it never fires on the fresh one.
        vi.advanceTimersByTime(60_000);
        ports[1]!.emit(view('n2'));
        expect(seen).toEqual([view('n1'), view('n2')]);
        expect(ports[1]!.terminated).toBe(false);
      });
    }
  }

  // R0-L31 (fix2 review F2): a Worker that never answered W.DISPOSE used to mute every later room of the tab — no
  // message, no onCrash, forever. No W.DISPOSED within 2000 ms of its W.DISPOSE is a crash.
  it('R0-L31: no W.DISPOSED 2000 ms after a W.DISPOSE = crash: terminate, the current room hears onCrash, the next acquire spawns fresh', () => {
    vi.useFakeTimers();
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    ports[0]!.emit(view('a1')); // a running Worker: its W.DISPOSE is timed from the post
    a.release();
    const b = host.acquire(() => undefined);
    const seen: unknown[] = [];
    const crashed = vi.fn();
    b.onMessage((m) => seen.push(m));
    b.onCrash(crashed);
    b.post(INIT);
    vi.advanceTimersByTime(1999);
    ports[0]!.emit(view('a-late')); // still the disposed room's traffic
    expect({ seen, crashes: crashed.mock.calls.length, terminated: ports[0]!.terminated }).toEqual({ seen: [], crashes: 0, terminated: false });
    vi.advanceTimersByTime(1);
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(ports[0]!.terminated).toBe(true);
    b.post(INIT); // the crashed room can no longer post
    ports[0]!.emit({ t: 'W.DISPOSED' }); // a late answer of the discarded Worker changes nothing
    expect(ports[0]!.posted).toEqual([{ t: 'W.DISPOSE' }, INIT]);
    const c = host.acquire(() => undefined);
    const cSeen: unknown[] = [];
    c.onMessage((m) => cSeen.push(m));
    c.post(INIT);
    ports[1]!.emit(view('c1'));
    expect(ports).toHaveLength(2);
    expect(cSeen).toEqual([view('c1')]);
    vi.advanceTimersByTime(3_600_000);
    expect(ports[1]!.terminated).toBe(false);
    expect(crashed).toHaveBeenCalledTimes(1);
  });

  it('R0-L31: with no room open the silent Worker is just forgotten; a W.DISPOSED in time cancels the watchdog', () => {
    vi.useFakeTimers();
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    ports[0]!.emit(view('a1'));
    a.release();
    vi.advanceTimersByTime(2000);
    expect(ports[0]!.terminated).toBe(true);
    host.prewarm();
    expect(ports).toHaveLength(2);
    ports[1]!.emit({ t: 'W.DISPOSED' }); // the probe's answer
    host.acquire(() => undefined).release();
    vi.advanceTimersByTime(1999);
    ports[1]!.emit({ t: 'W.DISPOSED' });
    vi.advanceTimersByTime(3_600_000);
    expect(ports[1]!.terminated).toBe(false);
    const next = host.acquire(() => undefined);
    const seen: unknown[] = [];
    next.onMessage((m) => seen.push(m));
    ports[1]!.emit(view('n1'));
    expect(seen).toEqual([view('n1')]);
    expect(ports).toHaveLength(2);
  });

  it('R0-L31: every W.DISPOSE has its own 2000 ms and W.DISPOSED answers the oldest (two quick rooms)', () => {
    vi.useFakeTimers();
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const a = host.acquire(() => undefined);
    ports[0]!.emit(view('a0'));
    a.release(); // t = 0: room a's W.DISPOSE
    vi.advanceTimersByTime(1500);
    host.acquire(() => undefined).release(); // t = 1500: room b's W.DISPOSE
    const c = host.acquire(() => undefined);
    const crashed = vi.fn();
    c.onCrash(crashed);
    vi.advanceTimersByTime(400);
    ports[0]!.emit({ t: 'W.DISPOSED' }); // t = 1900: a's answer, in time; b's deadline stays 3500
    vi.advanceTimersByTime(1599);
    ports[0]!.emit(view('b-late')); // t = 3499: b's W.DISPOSED is still due, so this is b's traffic
    expect(crashed).not.toHaveBeenCalled();
    expect(ports[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(ports[0]!.terminated).toBe(true);
  });

  // R0-L34 (fix3 review N1): the watchdog started at the post, so a W.DISPOSE sent while a fresh Worker was still
  // loading its script killed a healthy Worker 2000 ms later. It now starts at that Worker's first message.
  it("R0-L34: W.DISPOSEs posted before the Worker's first message get their 2000 ms from that message; a Worker silent after it is still a crash", () => {
    vi.useFakeTimers();
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    host.acquire(() => undefined).release(); // t = 0: room a, while the script is still loading
    vi.advanceTimersByTime(100);
    host.acquire(() => undefined).release(); // t = 100: room b
    const c = host.acquire(() => undefined);
    const seen: unknown[] = [];
    const crashed = vi.fn();
    c.onMessage((m) => seen.push(m));
    c.onCrash(crashed);
    const w = ports[0]!;
    vi.advanceTimersByTime(9900);
    expect({ crashes: crashed.mock.calls.length, terminated: w.terminated }).toEqual({ crashes: 0, terminated: false });
    w.emit(view('a1')); // t = 10000: the first message (a's room, dropped): both deadlines are now 12000
    vi.advanceTimersByTime(1000);
    w.emit({ t: 'W.DISPOSED' }); // t = 11000: a's answer; b's stays due at 12000
    vi.advanceTimersByTime(999);
    w.emit(view('b1')); // t = 11999: still b's traffic
    expect({ seen, crashes: crashed.mock.calls.length, terminated: w.terminated }).toEqual({ seen: [], crashes: 0, terminated: false });
    vi.advanceTimersByTime(1);
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(w.terminated).toBe(true);
  });

  it('R0-L34: a Worker that answered its probe and later hangs is a crash 2000 ms after the W.DISPOSE it ignores', async () => {
    vi.useFakeTimers();
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const warmed = host.prewarm();
    ports[0]!.emit({ t: 'W.DISPOSED' }); // the probe's answer: alive
    await expect(settled(warmed)).resolves.toBe(true);
    const a = host.acquire(() => undefined);
    a.post(INIT);
    ports[0]!.emit(view('a1'));
    vi.advanceTimersByTime(60_000); // a long table: no W.DISPOSE pending, nothing is timed
    expect(ports[0]!.terminated).toBe(false);
    a.release();
    const b = host.acquire(() => undefined);
    const crashed = vi.fn();
    b.onCrash(crashed);
    vi.advanceTimersByTime(1999);
    expect(crashed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(crashed).toHaveBeenCalledTimes(1);
    expect(ports[0]!.terminated).toBe(true);
  });

  it('R0-L34: prewarm() stays pending until the Worker answers its probe, then true; the same promise while that Worker lives, and nothing more is posted to it', async () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const warmed = host.prewarm();
    expect(host.prewarm()).toBe(warmed);
    expect(ports[0]!.posted).toEqual([{ t: 'W.DISPOSE' }]);
    await expect(settled(warmed)).resolves.toBe('pending'); // spawned is not enough: the script may still be loading
    const a = host.acquire(() => undefined);
    a.post(INIT);
    expect(host.prewarm()).toBe(warmed); // a room is open: a probe now would end it
    ports[0]!.emit({ t: 'W.DISPOSED' });
    await expect(settled(warmed)).resolves.toBe(true);
    expect(host.prewarm()).toBe(warmed);
    expect(ports[0]!.posted).toEqual([{ t: 'W.DISPOSE' }, INIT]);
    expect(ports).toHaveLength(1);
  });

  it('R0-L34: prewarm() is false when the Worker crashes before answering (error event, or W.FATAL first) and stays true after a later crash; every new Worker gets a new promise', async () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    const first = host.prewarm();
    ports[0]!.fireCrash(); // e.g. its script failed to load
    await expect(settled(first)).resolves.toBe(false);
    const second = host.prewarm();
    expect(second).not.toBe(first);
    expect(ports).toHaveLength(2);
    ports[1]!.emit({ t: 'W.DISPOSED' });
    ports[1]!.fireCrash();
    await expect(settled(second)).resolves.toBe(true); // it did run
    // Spawned by a table, not by prewarm: no probe (the room's own W.INIT is answered), and W.FATAL is no answer.
    host.acquire(() => undefined).post(INIT);
    const third = host.prewarm();
    expect(third).not.toBe(second);
    expect(ports[2]!.posted).toEqual([INIT]);
    ports[2]!.emit({ t: 'W.FATAL', code: 'E-ENG-INVALID-INIT' });
    await expect(settled(third)).resolves.toBe(false);
    // A crash listener that prewarms at once gets the fresh Worker's promise, untouched by the dead one's false.
    const d = host.acquire(() => undefined);
    const again: Promise<boolean>[] = [];
    d.onCrash(() => again.push(host.prewarm()));
    ports[3]!.fireCrash();
    expect(ports).toHaveLength(5);
    await expect(settled(again[0]!)).resolves.toBe('pending');
    ports[4]!.emit({ t: 'W.DISPOSED' });
    await expect(settled(again[0]!)).resolves.toBe(true);
  });

  it('R0-L34: a room opened right after prewarm hears its own messages once the probe is answered', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    host.prewarm();
    const a = host.acquire(() => undefined);
    const seen: unknown[] = [];
    a.onMessage((m) => seen.push(m));
    a.post(INIT);
    ports[0]!.emit({ t: 'W.DISPOSED' }); // the probe's
    ports[0]!.emit(view('a1'));
    expect(seen).toEqual([view('a1')]);
  });

  it('R0-L34: the probe lines up with the rooms after it: a room opened, ended and replaced before any answer leaks nothing into the next', () => {
    const { ports, spawn } = fakePorts();
    const host = createSharedHost(spawn);
    host.prewarm();
    const got = { a: [] as unknown[], b: [] as unknown[] };
    const a = host.acquire(() => undefined);
    a.onMessage((m) => got.a.push(m));
    a.post(INIT);
    a.release();
    const b = host.acquire(() => undefined);
    b.onMessage((m) => got.b.push(m));
    b.post(INIT);
    const w = ports[0]!;
    w.emit({ t: 'W.DISPOSED' }); // the probe's
    w.emit(view('a1'));
    w.emit({ t: 'W.OUT', to: 'local', env: { t: 'H.ACK', b: { c: 1 } } }); // would settle b's c = 1 if it leaked
    w.emit({ t: 'W.DISPOSED' }); // a's
    w.emit(view('b1'));
    expect(got).toEqual({ a: [], b: [view('b1')] });
    expect(w.posted).toEqual([{ t: 'W.DISPOSE' }, INIT, { t: 'W.DISPOSE' }, INIT]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The public wiring: createHostWorker -> tab host -> createPracticeClient, with `new Worker` stubbed.
// ---------------------------------------------------------------------------------------------------------------
class FakeWorker {
  static made: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  readonly posted: { t: string }[] = [];
  /** Every message the Worker delivered, in order (the raw objects the shared host saw). */
  readonly delivered: unknown[] = [];
  private readonly port = createInProcessHostPort({ clock: { nowMs: () => Date.now() } });
  constructor(
    readonly url: URL,
    readonly options: unknown,
  ) {
    FakeWorker.made.push(this);
    this.port.onMessage((data) => {
      this.delivered.push(data);
      this.onmessage?.({ data });
    });
  }
  postMessage(m: WorkerInbound): void {
    this.posted.push(m);
    this.port.post(m);
  }
  terminate(): void {
    this.terminated = true;
    this.port.terminate();
  }
}

const SETTINGS: RoomSettings = { seatCount: 2, sb: 50, bb: 100, startStack: 10000, turnSeconds: 60, liveEquity: true, botChatter: true };
const BOTS: BotSpec[] = [{ engine: 'rule', style: 'balanced', provider: null, model: null, label: 'Bot1' }];

function options(debugLog = vi.fn()): PracticeOptions {
  const config: AppConfig = { defaults, APP_VERSION: 'test-sha', debugLog, getE2EHooks: () => null };
  return {
    settings: SETTINGS,
    bots: BOTS,
    profile: { nickname: 'Mina', avatarSeed: 5, lang: 'en', updatedAt: '2026-11-01T00:00:00.000Z' },
    deps: {
      hands: { put: () => Promise.resolve(), get: () => Promise.resolve(null), list: () => Promise.resolve({ items: [], next: null }), count: () => Promise.resolve(0) },
      device: { getSecret: vi.fn(), roomPlayerKey: vi.fn(), regenerate: vi.fn() },
      config,
    },
  };
}

async function freshSession() {
  FakeWorker.made = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules(); // a fresh tab host singleton per test
  return import('./index'); // the `@/session` index itself
}

describe('@/session: prewarmPracticeHost + createPracticeClient share one Worker (offline D1 path)', () => {
  it('prewarm x3, then Leave -> table -> dispose mid-hand -> table: one Worker, never terminated, every table its own room', async () => {
    vi.useFakeTimers();
    const session = await freshSession();
    const warmed = session.prewarmPracticeHost();
    expect(session.prewarmPracticeHost()).toBe(warmed);
    expect(session.prewarmPracticeHost()).toBe(warmed);
    expect(FakeWorker.made).toHaveLength(1);
    const w = FakeWorker.made[0]!;
    expect(w.options).toEqual({ type: 'module' });

    const a = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    await expect(settled(warmed)).resolves.toBe(true); // the real shell answered the probe (R0-L34)
    const aHand = a.getSnapshot().view!.hand!.handId;
    const left = a.leave();
    await vi.advanceTimersByTimeAsync(1);
    await expect(left).resolves.toBeUndefined();
    expect(w.posted.filter((m) => m.t === 'W.DISPOSE')).toHaveLength(2); // the probe; then H.CLOSED gave the Worker back
    a.dispose(); // already given back: no third W.DISPOSE
    expect(w.posted.filter((m) => m.t === 'W.DISPOSE')).toHaveLength(2);

    const b = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    expect(b.getSnapshot().view).toMatchObject({ room: { phase: 'IN_HAND', handsPlayed: 0 }, hand: { no: 1 } });
    expect(b.getSnapshot().view!.hand!.handId).not.toBe(aHand);
    const bLastView = w.delivered.findLast((m) => (m as { env?: { t?: string } }).env?.t === 'H.VIEW');

    // PracticeScreen.create: dispose the running table, then open the next one at once (no await in between).
    const debugLog = vi.fn();
    b.dispose();
    const c = session.createPracticeClient(options(debugLog));
    // Old-room traffic still in flight lands before W.DISPOSED: a view of b and a closing message must be dropped.
    w.onmessage!({ data: bLastView });
    w.onmessage!({ data: { t: 'W.OUT', to: 'local', env: { v: 1, t: 'H.CLOSED', s: 999, b: { summary: { reason: 'host_closed_now', voidedHandId: null, handsPlayed: 0, seats: [], settings: SETTINGS } } } } });
    expect(c.getSnapshot()).toMatchObject({ view: null, closed: null, conn: { stage: 'ready' } });
    await vi.advanceTimersByTimeAsync(30_000); // b's timers would have fired by now
    const cv = c.getSnapshot().view!;
    expect(cv.room.phase === 'IN_HAND' || cv.room.phase === 'BETWEEN_HANDS').toBe(true);
    expect(cv.hand!.no).toBeGreaterThanOrEqual(1);
    expect(c.getSnapshot().closed).toBeNull();
    expect(debugLog).not.toHaveBeenCalled();
    const legal = cv.me.legal;
    if (legal) await expect(c.act({ seat: 0, type: legal.check ? 'check' : 'fold' })).resolves.toEqual({ ok: true });

    expect(FakeWorker.made).toHaveLength(1);
    expect(w.terminated).toBe(false);
    c.dispose();
  });

  it('a Worker crash fails the table with E-WORKER-CRASH and terminates the Worker; the next table spawns a fresh one', async () => {
    vi.useFakeTimers();
    const session = await freshSession();
    const a = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    FakeWorker.made[0]!.onerror!();
    expect(a.getSnapshot().conn).toMatchObject({ stage: 'failed', error: 'E-WORKER-CRASH' });
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    const b = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWorker.made).toHaveLength(2);
    expect(b.getSnapshot().view!.hand!.no).toBe(1);
    b.dispose();
  });

  it('R0-L30: the Worker crashes between a W.DISPOSE and its W.DISPOSED: the open table fails, the next one deals on a fresh Worker', async () => {
    vi.useFakeTimers();
    const session = await freshSession();
    const a = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    a.dispose(); // W.DISPOSE in flight
    const b = session.createPracticeClient(options());
    FakeWorker.made[0]!.onerror!(); // same tick: W.DISPOSED never arrives
    expect(b.getSnapshot().conn).toMatchObject({ stage: 'failed', error: 'E-WORKER-CRASH' });
    const c = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWorker.made).toHaveLength(2);
    expect(c.getSnapshot()).toMatchObject({ conn: { stage: 'ready' }, view: { room: { phase: 'IN_HAND' }, hand: { no: 1 } } });
    c.dispose();
  });

  it('R0-L31: a Worker that never answers W.DISPOSE: 2000 ms later the next table fails with E-WORKER-CRASH (not blank forever); the one after deals on a fresh Worker', async () => {
    vi.useFakeTimers();
    const session = await freshSession();
    // The old room's shell never sees its W.DISPOSE (a hung Worker): it keeps running and never answers.
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        override postMessage(m: WorkerInbound): void {
          if (m.t === 'W.DISPOSE') this.posted.push(m);
          else super.postMessage(m);
        }
      },
    );
    const a = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    a.dispose();
    const b = session.createPracticeClient(options());
    const chat = b.chat('hi'); // its answer is muted with the rest: without the watchdog it would never settle
    await vi.advanceTimersByTimeAsync(1999);
    expect(b.getSnapshot()).toMatchObject({ view: null, conn: { stage: 'ready' } });
    await vi.advanceTimersByTimeAsync(1);
    expect(b.getSnapshot().conn).toMatchObject({ stage: 'failed', error: 'E-WORKER-CRASH' });
    expect(FakeWorker.made[0]!.terminated).toBe(true);
    await expect(chat).resolves.toEqual({ ok: false, code: 'E-WORKER-CRASH' });
    const c = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWorker.made).toHaveLength(2);
    expect(c.getSnapshot()).toMatchObject({ conn: { stage: 'ready' }, view: { room: { phase: 'IN_HAND' }, hand: { no: 1 } } });
    c.dispose();
  });

  it('R0-L34 (fix3 review W3): the Worker script takes 2500 ms to load; table A disposed at 100 ms, table B opened at 200 ms -> B deals, no crash', async () => {
    vi.useFakeTimers();
    const session = await freshSession();
    // A Worker holds what it is sent until its script has run, as a browser does; here that takes 2500 ms.
    class SlowWorker extends FakeWorker {
      private early: WorkerInbound[] | null = [];
      constructor(url: URL, options: unknown) {
        super(url, options);
        setTimeout(() => {
          const queued = this.early ?? [];
          this.early = null;
          for (const m of queued) super.postMessage(m);
        }, 2500);
      }
      override postMessage(m: WorkerInbound): void {
        if (this.early === null) super.postMessage(m);
        else this.early.push(m);
      }
    }
    vi.stubGlobal('Worker', SlowWorker);
    const warmed = session.prewarmPracticeHost(); // t = 0: the shell warm-up, and a table at once
    const a = session.createPracticeClient(options());
    await vi.advanceTimersByTimeAsync(100);
    a.dispose(); // t = 100: e.g. Back from a table that never drew
    await vi.advanceTimersByTimeAsync(100);
    const b = session.createPracticeClient(options()); // t = 200
    await vi.advanceTimersByTimeAsync(2199); // t = 2399: the old watchdog had failed B at 2100
    expect(b.getSnapshot()).toMatchObject({ view: null, conn: { stage: 'ready' } });
    await expect(settled(warmed)).resolves.toBe('pending');
    await vi.advanceTimersByTimeAsync(201); // t = 2600: the script ran at 2500 and worked through its queue
    await expect(settled(warmed)).resolves.toBe(true);
    expect(b.getSnapshot()).toMatchObject({ conn: { stage: 'ready' }, view: { room: { phase: 'IN_HAND' }, hand: { no: 1 } } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(b.getSnapshot().conn).toMatchObject({ stage: 'ready' });
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.terminated).toBe(false);
    b.dispose();
  });

  it('prewarmPracticeHost resolves false where no Worker can be made; createPracticeClient still reports the failure', async () => {
    const session = await freshSession();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new DOMException('blocked', 'SecurityError');
        }
      },
    );
    await expect(session.prewarmPracticeHost()).resolves.toBe(false);
    expect(() => session.createPracticeClient(options())).toThrow(DOMException);
  });
});

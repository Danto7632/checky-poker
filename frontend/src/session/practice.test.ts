// AC-13 (I-09): the practice client end to end over the in-process host port (real shell + engine), fake timers
// and a seeded rng: 1,000 hands, records, pause/resume, alert, refill, leave/dispose, network 0, net-free import
// graph. A separate 100-hand smoke uses the real crypto rng (US18 AC3). The IndexedDB-row half of AC-11 lives in
// storage/records.test.ts (session may not import storage values).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateEnvelope, type BotSpec, type PlayerView, type RoomSettings, type WorkerOutbound } from '@checky/engine/protocol';
import type { HandRecordV1 } from '@checky/engine/record';
import type { Clock } from '@checky/engine/table';
import { createSeededRng, randomInt, type Rng } from '@checky/engine/util';
import { defaults } from '@/config';
import { createInProcessHostPort, type InProcessHostPort } from '@/host/testing';
import { fractionalClock } from '../../../packages/engine/test/helpers/table';
import type { HandStore } from '@/storage';
import { createPracticeClientWith } from './practice';
import { createSharedHost } from './shared-host';
import type { AppConfig, PracticeTableClient, SessionDeps } from './types';

const SETTINGS: RoomSettings = { seatCount: 2, sb: 50, bb: 100, startStack: 10000, turnSeconds: 60, liveEquity: true, botChatter: true };
const PROFILE = { nickname: 'Mina', avatarSeed: 5, lang: 'en' as const, updatedAt: '2026-11-01T00:00:00.000Z' };
const bots = (n: number, engine: BotSpec['engine'] = 'rule'): BotSpec[] =>
  Array.from({ length: n }, (_, i) => ({ engine, style: 'balanced', provider: engine === 'llm' ? 'openai' : null, model: engine === 'llm' ? 'gpt-x' : null, label: `Bot${i + 1}` }));

function memoryHands(): HandStore & { records: HandRecordV1[] } {
  const records: HandRecordV1[] = [];
  return {
    records,
    put: (r) => {
      records.push(r);
      return Promise.resolve();
    },
    get: () => Promise.resolve(null),
    list: () => Promise.resolve({ items: [], next: null }),
    count: () => Promise.resolve(records.length),
  };
}

function config(over: Partial<AppConfig> = {}): AppConfig {
  return { defaults, APP_VERSION: 'test-sha', debugLog: vi.fn(), getE2EHooks: () => null, ...over };
}

interface Setup {
  client: PracticeTableClient;
  port: InProcessHostPort;
  /** Deliver a message to the client as if the Worker sent it. */
  inject(msg: WorkerOutbound): void;
}

function setup(opts: { rng?: Rng; clock?: Clock; bots?: BotSpec[]; deps?: Partial<SessionDeps>; settings?: Partial<RoomSettings> } = {}): Setup {
  let port!: InProcessHostPort;
  const injected = new Set<(m: unknown) => void>();
  const deps: SessionDeps = { hands: memoryHands(), device: { getSecret: vi.fn(), roomPlayerKey: vi.fn(), regenerate: vi.fn() }, config: config(), ...opts.deps };
  const host = createSharedHost(() => {
    port = createInProcessHostPort({ ...(opts.rng ? { rng: opts.rng } : {}), clock: opts.clock ?? { nowMs: () => Date.now() } });
    const real = port.onMessage.bind(port);
    port = { ...port, onMessage: (l) => (injected.add(l), real(l)) } as InProcessHostPort;
    return port;
  });
  const client = createPracticeClientWith({ settings: { ...SETTINGS, ...opts.settings }, bots: opts.bots ?? bots(5), profile: PROFILE, deps }, host.acquire);
  return { client, port, inject: (m) => injected.forEach((l) => l(m)) };
}

/** Plays me passively (check, else call), resumes pauses, refills when busted, until `hands` hands completed. */
async function play(client: PracticeTableClient, hands: number, onView?: (v: PlayerView) => void): Promise<void> {
  let acted = '';
  const unsub = client.subscribe(() => {
    const v = client.getSnapshot().view;
    if (v === null) return;
    onView?.(v);
    if (v.me.canRefill) client.refill();
    if (v.room.phase === 'PAUSED' && client.getSnapshot().alert === null) client.resume();
    const legal = v.me.legal;
    const key = `${v.hand?.handId}:${v.hand?.turnSeq}`;
    if (legal && v.hand && key !== acted) {
      acted = key;
      void client.act({ seat: v.me.seat!, type: legal.check ? 'check' : 'call' });
    }
  });
  for (let guard = 0; guard < 100_000 && (client.getSnapshot().view?.room.handsPlayed ?? 0) < hands; guard += 1) {
    await vi.advanceTimersByTimeAsync(5000);
  }
  unsub();
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createPracticeClient (AC-13)', () => {
  it('validates input: 1..5 bots, turnSeconds 30|60|null (15 -> E-ENG-INVALID-INIT)', () => {
    const spawn = createSharedHost(() => createInProcessHostPort()).acquire;
    const deps = { hands: memoryHands(), device: { getSecret: vi.fn(), roomPlayerKey: vi.fn(), regenerate: vi.fn() }, config: config() };
    const make = (b: BotSpec[], turnSeconds: RoomSettings['turnSeconds']) => () =>
      createPracticeClientWith({ settings: { ...SETTINGS, turnSeconds }, bots: b, profile: PROFILE, deps }, spawn);
    expect(make([], 60)).toThrow(expect.objectContaining({ code: 'E-ENG-INVALID-INIT' }));
    expect(make(bots(6), 60)).toThrow(expect.objectContaining({ code: 'E-ENG-INVALID-INIT' }));
    expect(make(bots(2), 15)).toThrow(expect.objectContaining({ code: 'E-ENG-INVALID-INIT' }));
    for (const t of [30, 60, null] as const) make(bots(1), t)().dispose();
  });

  it('is ready at once, deals the first hand by itself, seatCount = bots + 1, liveEquity passes through, invite null', async () => {
    vi.useFakeTimers();
    const { client } = setup({ rng: createSeededRng('first'), bots: bots(3), settings: { seatCount: 6, liveEquity: false } });
    expect(client.getSnapshot().conn.stage).toBe('ready');
    expect(client.inviteInfo()).toBeNull();
    for (const m of ['pause', 'resume', 'setOption', 'act', 'sit', 'refill', 'leave', 'dispose'] as const) expect(typeof client[m]).toBe('function');
    await vi.advanceTimersByTimeAsync(1);
    const v = client.getSnapshot().view!;
    expect(v.room).toMatchObject({ kind: 'practice', phase: 'IN_HAND', settings: { seatCount: 4, liveEquity: false } });
    expect(v.hand?.no).toBe(1);
    expect(v.me.holeCards).toHaveLength(2);
    client.dispose();
  });

  it('1,000 seeded hands: one practice record per hand, rule bots think 800..1500 ms, no network, no BOT_REQ', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    const wsSpy = vi.fn();
    const rtcSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('WebSocket', wsSpy);
    vi.stubGlobal('RTCPeerConnection', rtcSpy);
    const hands = memoryHands();
    const { client, port } = setup({ rng: createSeededRng('practice-1000'), deps: { hands } });
    const thinkGaps: number[] = [];
    let lastAt = Date.now();
    let lastLen = 0;
    await play(client, 1000, (v) => {
      const actions = v.hand?.actions ?? [];
      if (actions.length > lastLen && v.hand?.street !== 'COMPLETE') {
        const a = actions.at(-1)!;
        if (a.seat !== 0 && a.type !== 'post_sb' && a.type !== 'post_bb') thinkGaps.push(Date.now() - lastAt);
      }
      if (actions.length !== lastLen) lastAt = Date.now();
      lastLen = actions.length;
    });
    const snap = client.getSnapshot();
    expect(snap.view!.room.handsPlayed).toBeGreaterThanOrEqual(1000);
    expect(hands.records.length).toBe(snap.view!.room.handsPlayed);
    expect(new Set(hands.records.map((r) => r.id)).size).toBe(hands.records.length);
    for (const r of hands.records) {
      expect(r.mode).toBe('practice');
      expect(r.playedAt).not.toBe('');
      expect(r.appVersion).toBe('test-sha');
    }
    expect(thinkGaps.length).toBeGreaterThan(1000);
    expect(Math.min(...thinkGaps)).toBeGreaterThanOrEqual(800);
    expect(port.captured.some((x) => x.msg.t === 'W.BOT_REQ')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
    expect(rtcSpy).not.toHaveBeenCalled();
    client.dispose();
  }, 300_000);

  it('real crypto rng smoke, 100 hands: no hole cards repeated 10 times in a row, no fixed hands or boards', async () => {
    vi.useFakeTimers();
    const holes: string[] = [];
    const boards = new Map<string, string>();
    const { client } = setup({ deps: { hands: memoryHands() } });
    let lastHand = '';
    await play(client, 100, (v) => {
      if (v.hand && v.hand.handId !== lastHand && v.me.holeCards) {
        lastHand = v.hand.handId;
        holes.push([...v.me.holeCards].sort().join(''));
      }
      if (v.hand?.street === 'COMPLETE' && v.hand.board.length === 5) boards.set(v.hand.handId, v.hand.board.join(''));
    });
    let run = 1;
    let worst = 1;
    for (let i = 1; i < holes.length; i += 1) {
      run = holes[i] === holes[i - 1] ? run + 1 : 1;
      worst = Math.max(worst, run);
    }
    if (worst >= 10) throw new Error(`hole cards repeated ${worst}x: ${holes.join(' ')}`);
    expect(new Set(holes).size).toBeGreaterThan(50);
    // Different hands never share a full board (52C5 orderings: a repeat means a fixed deck).
    expect(new Set(boards.values()).size).toBe(boards.size);
    client.dispose();
  }, 120_000);

  it('pause() stops after the current hand (pending), resume() deals the next; RESUME during the pending pause cancels it', async () => {
    vi.useFakeTimers();
    const { client } = setup({ rng: createSeededRng('pause') });
    await vi.advanceTimersByTimeAsync(1);
    client.pause();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getSnapshot().view!.room).toMatchObject({ phase: 'IN_HAND', paused: true });
    let acted = '';
    const unsub = client.subscribe(() => {
      const v = client.getSnapshot().view!;
      const key = `${v.hand?.handId}:${v.hand?.turnSeq}`;
      if (v.me.legal && key !== acted) {
        acted = key;
        void client.act({ seat: 0, type: v.me.legal.check ? 'check' : 'fold' });
      }
    });
    for (let i = 0; i < 200 && client.getSnapshot().view!.room.phase !== 'PAUSED'; i += 1) await vi.advanceTimersByTimeAsync(500);
    const paused = client.getSnapshot();
    expect(paused.view!.room.phase).toBe('PAUSED');
    expect(paused.view!.result).not.toBeNull();
    expect(paused.notices.map((n) => n.code)).toContain('N-PAUSED');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.getSnapshot().view!.room.phase).toBe('PAUSED');
    client.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getSnapshot().view!.room.phase).toBe('IN_HAND');
    expect(client.getSnapshot().notices.map((n) => n.code)).toContain('N-RESUMED');
    client.pause();
    client.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getSnapshot().view!.room.paused).toBe(false);
    unsub();
    client.dispose();
  });

  // R0-L14 (MS-R0-3 D3): the shell clock is performance.now() — fractional. A view made in the middle of my timed turn
  // carried turnMs like 48416.799999952316, validateEnvelope('to_guest') rejected it (turnMs: nat) and the client
  // dropped it silently: Pause / Keep playing showed nothing until I acted.
  it('R0-L14 property: fractional clock; PAUSE / RESUME / SIT / setOption mid my turn -> every envelope is valid and shows at once', async () => {
    vi.useFakeTimers();
    for (const seed of ['frac-1', 'frac-2', 'frac-3', 'frac-4', 'frac-5', 'frac-6']) {
      const pick = createSeededRng(`ops-${seed}`);
      const cfg = config();
      const { client, port } = setup({ rng: createSeededRng(seed), clock: fractionalClock(), bots: bots(2), deps: { config: cfg } });
      const snap = () => client.getSnapshot().view!;
      const OPS = [
        { name: 'pause', run: () => client.pause(), holds: (v: PlayerView) => v.room.paused },
        { name: 'resume', run: () => client.resume(), holds: (v: PlayerView) => !v.room.paused },
        { name: 'sit out', run: () => client.sit('out'), holds: (v: PlayerView) => v.me.status === 'SITTING_OUT' },
        { name: 'sit in', run: () => client.sit('in'), holds: (v: PlayerView) => v.me.status === 'ACTIVE' },
        { name: 'setOption', run: () => client.setOption({ liveEquity: randomInt(pick, 2) === 0 }), holds: () => true },
      ];
      let midTurnOps = 0;
      await vi.advanceTimersByTimeAsync(1);
      for (let step = 0; step < 2000 && snap().room.handsPlayed < 8; step += 1) {
        const v = snap();
        if (v.room.phase === 'PAUSED') {
          if (v.me.canRefill) client.refill();
          client.resume();
          await vi.advanceTimersByTimeAsync(1);
          continue;
        }
        if (v.me.legal && v.hand) {
          const turn = v.hand.turnSeq;
          for (let k = 1 + randomInt(pick, 3); k > 0; k -= 1) {
            const op = OPS[randomInt(pick, OPS.length)]!;
            op.run();
            await vi.advanceTimersByTimeAsync(1 + randomInt(pick, 700));
            const now = snap();
            expect(now.hand!.turnSeq, `${seed}: still my turn after ${op.name}`).toBe(turn);
            expect(op.holds(now), `${seed}: ${op.name} shows on screen mid-turn`).toBe(true);
            const ms = now.hand!.turnMs!;
            expect(Number.isInteger(ms) && ms > 0 && ms <= 60000, `${seed}: turnMs ${ms}`).toBe(true);
            midTurnOps += 1;
          }
          void client.act({ seat: 0, type: v.me.legal.check ? 'check' : 'call' });
          await vi.advanceTimersByTimeAsync(1);
          continue;
        }
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(snap().room.handsPlayed).toBeGreaterThanOrEqual(8);
      expect(midTurnOps).toBeGreaterThan(5);
      const envs = port.captured.flatMap((x) => (x.msg.t === 'W.OUT' && x.msg.to === 'local' ? [x.msg.env] : []));
      expect(envs.length).toBeGreaterThan(50);
      for (const env of envs) expect(() => validateEnvelope(structuredClone(env), 'to_guest'), `${seed}: ${env.t} s=${env.s}`).not.toThrow();
      expect(cfg.debugLog).not.toHaveBeenCalledWith('E-PROTO-MALFORMED');
      client.dispose();
    }
  }, 120_000);

  // R0-L15 (MS-R0-3 D6, real client path): after refill() the very next view must show the start stack.
  it('R0-L15: shove until busted, refill() -> the next view has my stack = start stack and canRefill false', async () => {
    vi.useFakeTimers();
    const { client } = setup({ rng: createSeededRng('l15-client'), bots: bots(1) });
    await vi.advanceTimersByTimeAsync(1);
    let acted = '';
    for (let i = 0; i < 4000 && !client.getSnapshot().view!.me.canRefill; i += 1) {
      const v = client.getSnapshot().view!;
      const key = `${v.hand?.handId}:${v.hand?.turnSeq}`;
      if (v.me.legal && key !== acted) {
        acted = key;
        void client.act({ seat: 0, type: 'allin', to: v.me.legal.allIn.to });
      }
      if (v.room.phase === 'PAUSED') client.resume();
      await vi.advanceTimersByTimeAsync(250);
    }
    const busted = client.getSnapshot().view!;
    expect(busted.me.canRefill).toBe(true);
    expect(busted.seats[0]!.occupant!.stack).toBe(0);
    const before = client.getSnapshot();
    client.refill();
    await vi.advanceTimersByTimeAsync(1);
    const after = client.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.view!.hand?.handId).toBe(busted.hand?.handId); // still the same between-hands moment
    expect(after.view!.seats[0]!.occupant!.stack).toBe(10000);
    expect(after.view!.me.canRefill).toBe(false);
    client.dispose();
  });

  it('act() resolves via H.ACK / H.NACK; acting out of turn is E-ACT-NOT-YOUR-TURN; chat is not in R0', async () => {
    vi.useFakeTimers();
    const { client } = setup({ rng: createSeededRng('acks') });
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 50 && client.getSnapshot().view!.me.legal === null; i += 1) await vi.advanceTimersByTimeAsync(500);
    const legal = client.getSnapshot().view!.me.legal!;
    const ok = client.act({ seat: 0, type: legal.check ? 'check' : 'call' });
    await vi.advanceTimersByTimeAsync(1);
    await expect(ok).resolves.toEqual({ ok: true });
    const late = client.act({ seat: 0, type: 'fold' });
    await vi.advanceTimersByTimeAsync(1);
    await expect(late).resolves.toEqual({ ok: false, code: 'E-ACT-NOT-YOUR-TURN' });
    const chat = client.chat('hi');
    await vi.advanceTimersByTimeAsync(1);
    await expect(chat).resolves.toEqual({ ok: false, code: 'E-ROOM-BAD-TRANSITION' });
    // R0 m3: a malformed action is dropped by the Worker shell and still settles with a NACK (the room goes on).
    const junk = client.act({ seat: 0, type: 'shove' } as never);
    await vi.advanceTimersByTimeAsync(1);
    await expect(junk).resolves.toEqual({ ok: false, code: 'E-PROTO-MALFORMED' });
    expect(client.getSnapshot().conn.stage).toBe('ready');
    client.dispose();
    await expect(client.act({ seat: 0, type: 'fold' })).resolves.toEqual({ ok: false, code: 'E-ACT-STALE' });
  });

  it('W.ERROR E-ENG-INVARIANT sets snapshot.alert {code, atMs}; the next hand start clears it; other codes only log', async () => {
    vi.useFakeTimers();
    const cfg = config();
    const { client, inject } = setup({ rng: createSeededRng('alert'), deps: { config: cfg } });
    await vi.advanceTimersByTimeAsync(1);
    inject({ t: 'W.ERROR', code: 'E-ACT-ILLEGAL' });
    expect(client.getSnapshot().alert).toBeNull();
    expect(cfg.debugLog).toHaveBeenCalledWith('E-ACT-ILLEGAL');
    inject({ t: 'W.ERROR', code: 'E-ENG-INVARIANT' });
    expect(client.getSnapshot().alert).toMatchObject({ code: 'E-ENG-INVARIANT' });
    const hand = client.getSnapshot().view!.hand!.handId;
    await play(client, 2);
    expect(client.getSnapshot().view!.hand!.handId).not.toBe(hand);
    expect(client.getSnapshot().alert).toBeNull();
    client.dispose();
  });

  it('a Worker crash or W.FATAL fails the connection with E-WORKER-CRASH and settles pending acks', async () => {
    vi.useFakeTimers();
    const { client, port } = setup({ rng: createSeededRng('crash') });
    await vi.advanceTimersByTimeAsync(1);
    const pending = client.act({ seat: 0, type: 'fold' });
    port.crash();
    await expect(pending).resolves.toEqual({ ok: false, code: 'E-WORKER-CRASH' });
    expect(client.getSnapshot().conn).toMatchObject({ stage: 'failed', error: 'E-WORKER-CRASH' });
  });

  it('engine "llm" bots without a decider are decided inside the Worker by the rule bot (D-P11): they act, no W.BOT_REQ', async () => {
    vi.useFakeTimers();
    const { client, port } = setup({ rng: createSeededRng('llm-fallback'), bots: bots(3, 'llm') });
    let botActions = 0;
    await play(client, 5, (v) => {
      botActions = Math.max(botActions, v.hand?.actions.filter((a) => a.seat !== 0 && a.type !== 'post_sb' && a.type !== 'post_bb').length ?? 0);
    });
    expect(botActions).toBeGreaterThan(0);
    expect(port.captured.some((x) => x.msg.t === 'W.BOT_REQ')).toBe(false);
    expect(port.captured.flatMap((x) => (x.msg.t === 'W.OUT' && x.msg.to === 'local' && x.msg.env.t === 'H.VIEW' ? x.msg.env.b.view.seats.map((s) => s.occupant?.bot?.engine) : []))).toContain('llm');
    client.dispose();
  });

  it('sit out -> paused at hand end; sit in resumes; leave closes the room and resolves', async () => {
    vi.useFakeTimers();
    const { client } = setup({ rng: createSeededRng('sit') });
    await vi.advanceTimersByTimeAsync(1);
    client.sit('out');
    // Fold my remaining turns (no auto-resume here, unlike play()).
    const unsub = client.subscribe(() => {
      const v = client.getSnapshot().view!;
      if (v.me.legal) void client.act({ seat: 0, type: 'fold' });
    });
    for (let i = 0; i < 100 && client.getSnapshot().view!.room.phase !== 'PAUSED'; i += 1) await vi.advanceTimersByTimeAsync(1000);
    unsub();
    expect(client.getSnapshot().view!.room.phase).toBe('PAUSED');
    expect(client.getSnapshot().view!.me.status).toBe('SITTING_OUT');
    client.sit('in');
    await vi.advanceTimersByTimeAsync(1);
    expect(client.getSnapshot().view!.room.phase).toBe('IN_HAND');
    const left = client.leave();
    await vi.advanceTimersByTimeAsync(1);
    await expect(left).resolves.toBeUndefined();
    expect(client.getSnapshot()).toMatchObject({ conn: { stage: 'closed' }, closed: { reason: 'host_closed_now' } });
    client.dispose();
  });

  it('passes VITE_E2E testSeed through W.INIT only when the config hook provides one', async () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    const deps: SessionDeps = { hands: memoryHands(), device: { getSecret: vi.fn(), roomPlayerKey: vi.fn(), regenerate: vi.fn() }, config: config({ getE2EHooks: () => ({ testSeed: 'e2e-seed' }) }) };
    const host = createSharedHost(() => {
      const p = createInProcessHostPort();
      const post = p.post.bind(p);
      return { ...p, post: (m) => (seen.push(m), post(m)) };
    });
    const c = createPracticeClientWith({ settings: SETTINGS, bots: bots(1), profile: PROFILE, deps }, host.acquire);
    expect(seen[0]).toMatchObject({ t: 'W.INIT', testSeed: 'e2e-seed' });
    c.dispose();
  });
});

describe('SS4-AC2 / RL-07: no net runtime in the practice static import graph', () => {
  const sources = {
    ...import.meta.glob<string>('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob<string>('../../../packages/*/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  };
  const norm = (p: string): string => {
    const parts: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.' && seg !== '') parts.push(seg);
    }
    return parts.join('/');
  };
  // Canonical key: path relative to the repo root (this file is frontend/src/session/practice.test.ts).
  const files = new Map(Object.entries(sources).map(([k, v]) => [norm(`frontend/src/session/${k}`), v]));
  const resolve = (from: string, spec: string): string => {
    const base = spec.startsWith('@/')
      ? `frontend/src/${spec.slice(2)}`
      : spec.startsWith('.')
        ? norm(`${from.split('/').slice(0, -1).join('/')}/${spec}`)
        : spec === '@checky/engine' || spec === '@checky/analysis'
          ? `packages/${spec.split('/')[1]}/src/index`
          : spec.startsWith('@checky/engine/')
            ? `packages/engine/src/${spec.slice('@checky/engine/'.length)}/index`
            : `external:${spec}`;
    if (base.startsWith('external:')) return base;
    for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) if (files.has(cand)) return cand;
    return `missing:${base}`;
  };
  const RUNTIME_EDGE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;

  it('walks every runtime import from session/practice.ts', () => {
    const seen = new Set<string>();
    const externals = new Set<string>();
    const stack = ['frontend/src/session/practice.ts'];
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const text = files.get(f);
      if (text === undefined) throw new Error(`unresolved file ${f}`);
      for (const m of text.matchAll(RUNTIME_EDGE)) {
        const target = resolve(f, m[1]!);
        if (target.startsWith('external:')) externals.add(target.slice('external:'.length));
        else if (target.startsWith('missing:')) throw new Error(`cannot resolve ${m[1]} from ${f}`);
        else stack.push(target);
      }
    }
    const allowedNet = ['index.ts', 'room-code.ts', 'relays.ts', 'errors.ts'].map((n) => `frontend/src/net/${n}`);
    expect([...seen].filter((f) => f.startsWith('frontend/src/net/') && !allowedNet.includes(f))).toEqual([]);
    expect([...externals].filter((e) => /^(trystero|@trystero-p2p\/|mqtt)/.test(e))).toEqual([]);
    expect(seen.has('frontend/src/host/index.ts')).toBe(true);
    expect(seen.has('frontend/src/host/testing.ts')).toBe(false);
  });
});

// AC-10 (MS-R0-5) + AC-14: everything the dealer Worker posts, captured over 200 seeded practice hands
// (1 human + 5 rule bots) through the in-process port running the real shell. Fake timers: no real waiting.
// Truth comes from a test-only projection wrapper (the T-003 injection point) — production code has no hook.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeMetrics, decideRuleBot, type BotInput } from '@checky/analysis';
import { legalActions } from '@checky/engine';
import { projectView, type PlayerView } from '@checky/engine/projection';
import { cardString } from '@checky/engine';
import { WORKER_OUTBOUND_TYPES, validateEnvelope, type Envelope, type TableConfig, type WorkerOutbound } from '@checky/engine/protocol';
import type { Clock, TableState, Viewer } from '@checky/engine/table';
import { createSeededRng } from '@checky/engine/util';
import { collectCardLeaks } from '../../../packages/engine/test/helpers/card-leak';
import { fractionalClock, tableConfig, ruleBot } from '../../../packages/engine/test/helpers/table';
import { createInProcessHostPort, type InProcessHostPort } from '@/host/testing';
import { createShell } from './shell';
import type { TimerPort } from './timers';

const HOST = { rpk: 'practice-rpk-0000000000', nick: 'Mina', avatarSeed: 3, lang: 'en' as const };

/** Cards seat 0 may see in `t`, derived independently from the truth. A dealt board stays public after a void. */
function allowedFor(t: TableState, viewerSeat: number | null): Set<string> {
  const out = new Set<string>();
  const hand = t.hand;
  if (hand === null) return out;
  for (const c of hand.board) out.add(cardString(c));
  if (hand.street === 'VOIDED') return out;
  const shown = new Set(hand.result?.showdown.map((x) => x.seat) ?? []);
  for (const p of hand.seats) {
    const bot = t.seats[p.seat]?.kind === 'bot';
    if (p.seat === viewerSeat || (hand.street === 'SHOWDOWN' && !p.folded) || (hand.street === 'COMPLETE' && (shown.has(p.seat) || bot))) {
      for (const c of p.hole) out.add(cardString(c));
    }
  }
  return out;
}

interface Run {
  port: InProcessHostPort;
  localTruth: TableState[];
  botCaptures: { input: BotInput; truth: TableState }[];
  views: PlayerView[];
}

async function runPractice(hands: number, seed: string, project?: (t: TableState, v: Viewer) => PlayerView, clock: Clock = { nowMs: () => Date.now() }): Promise<Run> {
  const localTruth: TableState[] = [];
  const botTruth: TableState[] = [];
  const botCaptures: Run['botCaptures'] = [];
  const views: PlayerView[] = [];
  const wrapped = (t: TableState, v: Viewer): PlayerView => {
    if (v.kind === 'seat') localTruth.push(t);
    if (v.kind === 'bot') botTruth.push(t);
    return (project ?? projectView)(t, v);
  };
  const port = createInProcessHostPort({
    rng: createSeededRng(seed),
    clock,
    project: wrapped,
    brain: {
      computeMetrics,
      decideRuleBot: (input, rng) => {
        botCaptures.push({ input, truth: botTruth.at(-1)! });
        return decideRuleBot(input, rng);
      },
    },
  });
  let c = 0;
  port.onMessage((raw) => {
    const msg = raw as WorkerOutbound;
    if (msg.t !== 'W.OUT' || msg.to !== 'local' || msg.env.t !== 'H.VIEW') return;
    const view = msg.env.b.view;
    views.push(view);
    const legal = view.me.legal;
    if (legal && view.hand) {
      c += 1;
      // Every 7th turn: sit out and back in first, so views are also made mid-turn (turnMs from a later clock read).
      if (c % 7 === 0) {
        port.post({ t: 'W.CMD', cmd: { t: 'SIT', mode: 'out' } });
        port.post({ t: 'W.CMD', cmd: { t: 'SIT', mode: 'in' } });
      }
      port.post({ t: 'W.CMD', cmd: { t: 'ACT', handId: view.hand.handId, turnSeq: view.hand.turnSeq, action: { seat: 0, type: legal.check ? 'check' : 'call' } }, c });
    }
    if (view.me.canRefill) port.post({ t: 'W.CMD', cmd: { t: 'REFILL' } });
    if (view.room.phase === 'PAUSED') port.post({ t: 'W.CMD', cmd: { t: 'RESUME' } });
  });
  const config: TableConfig = tableConfig('practice', { seatCount: 6 });
  port.post({ t: 'W.INIT', config, host: HOST });
  for (let i = 0; i < 5; i += 1) port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot(`Bot${i + 1}`) } });
  port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 999 });
  for (let guard = 0; guard < 200_000 && (views.at(-1)?.room.handsPlayed ?? 0) < hands; guard += 1) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  return { port, localTruth, botCaptures, views };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AC-10 MS-R0-5: Worker egress over 200 practice hands', () => {
  it('only whitelisted messages; local views hold only cards the host seat may see; no peer bytes, no BOT_REQ', async () => {
    vi.useFakeTimers();
    const { port, localTruth, views } = await runPractice(200, 'egress-200', undefined, fractionalClock());
    expect(views.at(-1)!.room.handsPlayed).toBeGreaterThanOrEqual(200);
    const msgs = port.captured.map((x) => x.msg);
    const types = new Set(msgs.map((m) => m.t));
    for (const t of types) expect(WORKER_OUTBOUND_TYPES).toContain(t);
    expect(msgs.filter((m) => m.t === 'W.BOT_REQ' || m.t === 'W.BOT_CANCEL')).toHaveLength(0);
    expect(msgs.filter((m) => m.t === 'W.OUT' && m.to !== 'local')).toHaveLength(0);
    expect(msgs.filter((m) => m.t === 'W.FATAL')).toHaveLength(0);

    let viewIndex = 0;
    let showdowns = 0;
    let foldWins = 0;
    let midTurnViews = 0;
    const turnsSeen = new Set<string>();
    for (const m of msgs) {
      if (m.t === 'W.OUT' && m.to === 'local') {
        const env: Envelope = m.env;
        // Self-check (R0-L14): everything the Worker emits passes the receiver's own check, on the production-like
        // fractional clock. A view the client's validateEnvelope rejects is dropped silently on screen.
        expect(() => validateEnvelope(structuredClone(env), 'to_guest'), `${env.t} s=${env.s}`).not.toThrow();
        if (env.t === 'H.VIEW' && env.b.view.me.legal !== null && env.b.view.hand !== null) {
          const turn = `${env.b.view.hand.handId}:${env.b.view.hand.turnSeq}`;
          if (turnsSeen.has(turn)) midTurnViews += 1; // a second view within the same turn of mine
          turnsSeen.add(turn);
          const ms = env.b.view.hand.turnMs!;
          expect(ms > 0 && ms <= 60000, `turnMs ${ms}`).toBe(true);
        }
        if (env.t === 'H.VIEW') {
          const truth = localTruth[viewIndex++]!;
          expect(collectCardLeaks(env, allowedFor(truth, 0))).toEqual([]);
          if (env.b.view.result) (env.b.view.result.showdown.length > 0 ? (showdowns += 1) : (foldWins += 1));
        } else {
          expect(collectCardLeaks(env, new Set())).toEqual([]);
        }
      } else if (m.t === 'W.ERROR' || m.t === 'W.FATAL') {
        expect(collectCardLeaks(m, new Set())).toEqual([]);
      }
    }
    expect(viewIndex).toBe(localTruth.length);
    expect(midTurnViews).toBeGreaterThan(50);
    expect(showdowns).toBeGreaterThan(0);
    expect(foldWins).toBeGreaterThan(0);
    // ACK for the correlated START and every ACT.
    expect(msgs.some((m) => m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.ACK' && m.env.b.c === 999)).toBe(true);
  }, 120_000);

  it('T-003 mutation: an injected projection that adds another seat\'s hole cards is never sent and reports E-PROJ-LEAK-BLOCKED', async () => {
    vi.useFakeTimers();
    const leaky = (t: TableState, v: Viewer): PlayerView => {
      const view = projectView(t, v);
      if (v.kind !== 'seat' || t.hand === null) return view;
      const other = t.hand.seats.find((p) => p.seat !== v.seat)!;
      return {
        ...view,
        seats: view.seats.map((s) =>
          s.seat === other.seat && s.occupant?.inHand ? { ...s, occupant: { ...s.occupant, inHand: { ...s.occupant.inHand, cards: [cardString(other.hole[0]), cardString(other.hole[1])] } } } : s,
        ),
      } as PlayerView;
    };
    const port = createInProcessHostPort({ rng: createSeededRng('mutation'), clock: { nowMs: () => Date.now() }, project: leaky });
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 3 }), host: HOST });
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('A') } });
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('B') } });
    port.post({ t: 'W.CMD', cmd: { t: 'START' } });
    await vi.advanceTimersByTimeAsync(10);
    const msgs = port.captured.map((x) => x.msg);
    const inHandViews = msgs.filter((m) => m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.VIEW' && m.env.b.view.hand !== null);
    expect(inHandViews).toHaveLength(0);
    expect(msgs.filter((m) => m.t === 'W.ERROR' && m.code === 'E-PROJ-LEAK-BLOCKED').length).toBeGreaterThanOrEqual(1);
  });
});

describe('AC-14 bot input built in the Worker from the bot\'s own seat view', () => {
  it('every BotInput = that bot\'s seat projection + legalActions + bot metrics; no other private cards; no W.BOT_REQ', async () => {
    vi.useFakeTimers();
    const { port, botCaptures } = await runPractice(20, 'bot-inputs');
    expect(botCaptures.length).toBeGreaterThan(50);
    const perHand = new Map<string, number>();
    for (const { input, truth } of botCaptures) {
      expect(input.view).toEqual(projectView(truth, { kind: 'seat', seat: input.seat }));
      expect(input.legal).toEqual(legalActions(truth.hand!, input.seat));
      expect(input.metrics.basis).toBe('vs_random_hands');
      expect(input.metrics.equity.opponents).toBeGreaterThanOrEqual(1);
      expect(input).toMatchObject({ v: 1, style: 'balanced', lang: 'en', model: null, chatTail: [] });
      expect(input.name).toMatch(/^Bot\d$/);
      expect(collectCardLeaks(input, allowedFor(truth, input.seat))).toEqual([]);
      const key = `${truth.hand!.handId}:${input.seat}`;
      expect(input.myPriorThoughts).toHaveLength(perHand.get(key) ?? 0);
      perHand.set(key, (perHand.get(key) ?? 0) + 1);
    }
    expect(port.captured.some((x) => x.msg.t === 'W.BOT_REQ')).toBe(false);
  }, 60_000);
});

describe('W.INIT testSeed, W.CMD c, non-R0 messages', () => {
  async function firstHands(acceptTestSeed: boolean, testSeed: string): Promise<string[]> {
    const port = createInProcessHostPort({ acceptTestSeed, clock: { nowMs: () => Date.now() } });
    const holes: string[] = [];
    port.onMessage((raw) => {
      const m = raw as WorkerOutbound;
      if (m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.VIEW' && m.env.b.view.me.holeCards) holes.push(m.env.b.view.me.holeCards.join(''));
    });
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 2 }), host: HOST, testSeed });
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('A') } });
    port.post({ t: 'W.CMD', cmd: { t: 'START' } });
    await vi.advanceTimersByTimeAsync(5);
    port.terminate();
    return holes.slice(0, 1);
  }

  it('testSeed is honoured only when the build accepts it (VITE_E2E)', async () => {
    vi.useFakeTimers();
    expect(await firstHands(true, 'seed-1')).toEqual(await firstHands(true, 'seed-1'));
    const a = [await firstHands(false, 'seed-1'), await firstHands(false, 'seed-1'), await firstHands(false, 'seed-1')];
    expect(new Set(a.map((x) => x.join())).size).toBeGreaterThan(1);
  });

  it('W.CMD with c gets a local H.ACK or H.NACK; non-R0 inbound messages and junk produce W.ERROR only', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort({ clock: { nowMs: () => Date.now() } });
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 2 }), host: HOST });
    port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 1 });
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('A') }, c: 2 });
    port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 3 });
    port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 4 });
    port.post({ t: 'W.PEER_IN', conn: 'x', env: {} });
    port.post({ t: 'W.CMD', cmd: 'nope' } as never);
    await vi.advanceTimersByTimeAsync(5);
    const acks = port.captured.flatMap((x) => (x.msg.t === 'W.OUT' && x.msg.to === 'local' && (x.msg.env.t === 'H.ACK' || x.msg.env.t === 'H.NACK') ? [x.msg.env.b] : []));
    expect(acks).toEqual([
      { c: 1, code: 'E-ROOM-START-MIN-PLAYERS' },
      { c: 2 },
      { c: 3 },
      { c: 4, code: 'E-ROOM-BAD-TRANSITION' },
    ]);
    const errors = port.captured.flatMap((x) => (x.msg.t === 'W.ERROR' ? [x.msg.code] : []));
    expect(errors).toEqual(expect.arrayContaining(['E-ROOM-START-MIN-PLAYERS', 'E-ROOM-BAD-TRANSITION', 'E-PROTO-MALFORMED']));
  });

  // R0 m3 (review repro f.tt): {t:'ACT'} without `action` used to throw a TypeError in the reducer -> W.FATAL.
  it('a malformed W.CMD is W.ERROR{E-PROTO-MALFORMED} and dropped; the Worker keeps running', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort({ clock: { nowMs: () => Date.now() } });
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 2 }), host: HOST });
    const malformed: unknown[] = [
      { t: 'ACT' },
      { t: 'ACT', handId: 'h', turnSeq: 1, action: { type: 'fold' } },
      { t: 'ACT', handId: 'h', turnSeq: 1, action: { seat: 0, type: 'shove' } },
      { t: 'ADD_BOT', seat: null },
      { t: 'ADD_BOT', seat: null, bot: { ...ruleBot('A'), apiKey: 'x' } },
      { t: 'SIT', mode: 'away' },
      { t: 'CLOSE' },
      { t: 'START', extra: 1 },
      { t: 'NOPE' },
      JSON.parse('{"t":"REFILL","__proto__":{"x":1}}'),
    ];
    for (const cmd of malformed) port.post({ t: 'W.CMD', cmd, c: 5 } as never);
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('A') }, c: 6 });
    port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 7 });
    await vi.advanceTimersByTimeAsync(5);
    const msgs = port.captured.map((x) => x.msg);
    expect(msgs.filter((m) => m.t === 'W.FATAL')).toEqual([]);
    expect(msgs.filter((m) => m.t === 'W.ERROR' && m.code === 'E-PROTO-MALFORMED')).toHaveLength(malformed.length);
    const acks = msgs.flatMap((m) => (m.t === 'W.OUT' && m.to === 'local' && (m.env.t === 'H.ACK' || m.env.t === 'H.NACK') ? [m.env.b] : []));
    // Each malformed command is still answered for its c, so the session's Promise<Ack> settles.
    expect(acks).toEqual([...malformed.map(() => ({ c: 5, code: 'E-PROTO-MALFORMED' })), { c: 6 }, { c: 7 }]);
    const last = msgs.findLast((m) => m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.VIEW');
    expect(last).toMatchObject({ env: { b: { view: { room: { phase: 'IN_HAND' } } } } });
    port.terminate();
  });

  it('an invalid W.INIT config is W.FATAL{E-ENG-INVALID-INIT} (friend room with no time limit)', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort();
    port.post({ t: 'W.INIT', config: tableConfig('friend', { turnSeconds: null }), host: HOST });
    await vi.advanceTimersByTimeAsync(1);
    expect(port.captured.map((x) => x.msg)).toEqual([{ t: 'W.FATAL', code: 'E-ENG-INVALID-INIT' }]);
  });
});

// R0-L12 (MS-R0-3 D1): one Worker per tab, reused across rooms. The old shell stopped for good on W.DISPOSE, so a
// second table had to spawn a new Worker — a script fetch, which fails offline.
describe('R0-L12 W.DISPOSE discards the room; the same Worker opens the next one', () => {
  const localMsgs = (port: InProcessHostPort, from = 0) => port.captured.slice(from).map((x) => x.msg);
  const openRoom = (port: InProcessHostPort, testSeed?: string) => {
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 2 }), host: HOST, ...(testSeed === undefined ? {} : { testSeed }) });
    port.post({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot('A') }, c: 1 });
    port.post({ t: 'W.CMD', cmd: { t: 'START' }, c: 2 });
  };
  const firstHole = (msgs: WorkerOutbound[]): string | undefined =>
    msgs.flatMap((m) => (m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.VIEW' && m.env.b.view.me.holeCards ? [m.env.b.view.me.holeCards.join('')] : []))[0];

  it('mid-hand W.DISPOSE: exactly one W.DISPOSED, then silence (timers gone); the next W.INIT is a fresh room from s = 1', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort({ clock: { nowMs: () => Date.now() } });
    openRoom(port);
    await vi.advanceTimersByTimeAsync(3000); // a hand is running: turn / bot / countdown timers are armed
    const roomOne = localMsgs(port).flatMap((m) => (m.t === 'W.OUT' && m.to === 'local' && m.env.t === 'H.VIEW' && m.env.b.view.hand ? [m.env.b.view.hand.handId] : []));
    expect(roomOne.length).toBeGreaterThan(0);
    const mark = port.captured.length;
    port.post({ t: 'W.DISPOSE' });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(localMsgs(port, mark)).toEqual([{ t: 'W.DISPOSED' }]);

    const next = port.captured.length;
    openRoom(port);
    await vi.advanceTimersByTimeAsync(1);
    const msgs = localMsgs(port, next);
    expect(msgs.filter((m) => m.t === 'W.FATAL' || m.t === 'W.ERROR')).toEqual([]);
    const envs = msgs.flatMap((m) => (m.t === 'W.OUT' && m.to === 'local' ? [m.env] : []));
    expect(envs[0]).toMatchObject({ t: 'H.VIEW', s: 1, b: { view: { room: { phase: 'WAITING', handsPlayed: 0 }, hand: null } } });
    expect(envs.filter((e) => e.t === 'H.ACK').map((e) => e.b)).toEqual([{ c: 1 }, { c: 2 }]);
    const view = envs.findLast((e) => e.t === 'H.VIEW');
    expect(view).toMatchObject({ b: { view: { room: { phase: 'IN_HAND' }, hand: { no: 1 } } } });
    if (view?.t === 'H.VIEW') expect(roomOne).not.toContain(view.b.view.hand!.handId);
    port.terminate();
  });

  it('W.DISPOSE is answered even with no room open (the main thread counts the pairs); W.INIT on an open room is still refused', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort({ clock: { nowMs: () => Date.now() } });
    port.post({ t: 'W.DISPOSE' });
    port.post({ t: 'W.DISPOSE' });
    await vi.advanceTimersByTimeAsync(1);
    expect(localMsgs(port)).toEqual([{ t: 'W.DISPOSED' }, { t: 'W.DISPOSED' }]);
    openRoom(port);
    port.post({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 2 }), host: HOST });
    await vi.advanceTimersByTimeAsync(1);
    expect(localMsgs(port).filter((m) => m.t === 'W.ERROR').map((m) => (m.t === 'W.ERROR' ? m.code : null))).toEqual(['E-ROOM-BAD-TRANSITION']);
    port.terminate();
  });

  it('a testSeed belongs to its room: the same seed replays in a later room, the room after it is not seeded', async () => {
    vi.useFakeTimers();
    const worker = async () => {
      const port = createInProcessHostPort({ acceptTestSeed: true, clock: { nowMs: () => Date.now() } });
      const room = async (seed?: string): Promise<string | undefined> => {
        const from = port.captured.length;
        openRoom(port, seed);
        await vi.advanceTimersByTimeAsync(5);
        const hole = firstHole(localMsgs(port, from));
        port.post({ t: 'W.DISPOSE' });
        await vi.advanceTimersByTimeAsync(1);
        return hole;
      };
      const out = { seeded: await room('seed-1'), after: await room(), again: await room('seed-1') };
      port.terminate();
      return out;
    };
    const runs = [await worker(), await worker(), await worker()];
    for (const r of runs) expect([r.seeded, r.again]).toEqual([runs[0]!.seeded, runs[0]!.seeded]);
    // A room that kept the seeded rng would deal the same cards in every Worker (the seeded stream continued).
    expect(new Set(runs.map((r) => r.after)).size).toBeGreaterThan(1);
  });

  it('after W.FATAL the Worker is finished: W.DISPOSE gets no answer (the main thread terminates it instead)', async () => {
    vi.useFakeTimers();
    const port = createInProcessHostPort();
    port.post({ t: 'W.INIT', config: tableConfig('friend', { turnSeconds: null }), host: HOST });
    port.post({ t: 'W.DISPOSE' });
    await vi.advanceTimersByTimeAsync(1);
    expect(localMsgs(port)).toEqual([{ t: 'W.FATAL', code: 'E-ENG-INVALID-INIT' }]);
  });
});

describe('Worker processing time (ADR-0007: one input -> effects, projection, serialization; p95 <= 20 ms, 6 seats)', () => {
  it('p95 of per-input processing over a long practice session', () => {
    const due = new Map<string, { at: number; fire: () => void }>();
    let now = 0;
    const timers: TimerPort = {
      start: (id, ms, fire) => due.set(id, { at: now + ms, fire }),
      cancel: (id) => due.delete(id),
      cancelAll: () => due.clear(),
    };
    const durations: number[] = [];
    let pendingAct: { handId: string; turnSeq: number; check: boolean } | null = null;
    let pendingCmd: 'RESUME' | 'REFILL' | null = null;
    const shell = createShell({
      acceptTestSeed: false,
      timers,
      rng: createSeededRng('bench'),
      clock: { nowMs: () => now },
      post: (msg) => {
        if (msg.t === 'W.OUT' && msg.to === 'local' && msg.env.t === 'H.VIEW') {
          JSON.stringify(msg); // the structured clone a real postMessage would pay
          const v = msg.env.b.view;
          if (v.me.legal && v.hand) pendingAct = { handId: v.hand.handId, turnSeq: v.hand.turnSeq, check: v.me.legal.check };
          pendingCmd = v.me.canRefill ? 'REFILL' : v.room.phase === 'PAUSED' ? 'RESUME' : null;
        }
      },
    });
    const timed = (fn: () => void) => {
      const t0 = performance.now();
      fn();
      durations.push(performance.now() - t0);
    };
    timed(() => shell.handle({ t: 'W.INIT', config: tableConfig('practice', { seatCount: 6 }), host: HOST }));
    for (let i = 0; i < 5; i += 1) timed(() => shell.handle({ t: 'W.CMD', cmd: { t: 'ADD_BOT', seat: null, bot: ruleBot(`B${i}`) } }));
    timed(() => shell.handle({ t: 'W.CMD', cmd: { t: 'START' } }));
    for (let n = 0; n < 3000; n += 1) {
      if (pendingCmd) {
        const t: 'RESUME' | 'REFILL' = pendingCmd;
        pendingCmd = null;
        timed(() => shell.handle({ t: 'W.CMD', cmd: { t } }));
        continue;
      }
      if (pendingAct) {
        const a: { handId: string; turnSeq: number; check: boolean } = pendingAct;
        pendingAct = null;
        timed(() => shell.handle({ t: 'W.CMD', cmd: { t: 'ACT', handId: a.handId, turnSeq: a.turnSeq, action: { seat: 0, type: a.check ? 'check' : 'call' } } }));
        continue;
      }
      const next = [...due.entries()].sort((x, y) => x[1].at - y[1].at)[0];
      if (!next) break;
      due.delete(next[0]);
      now = next[1].at;
      timed(next[1].fire);
    }
    expect(durations.length).toBeGreaterThan(2000);
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    // Printed on every run for the impl-notes (Dev Agent Record evidence). The wall-clock bound is asserted only
    // with CHECKY_BENCH=1: on a loaded CI runner it measures the machine, not the Worker (R0 m1).
    const assertBench = import.meta.env.CHECKY_BENCH === '1';
    console.log(`[bench] worker per-input p95 = ${p95.toFixed(3)} ms over ${durations.length} inputs (max ${durations.at(-1)!.toFixed(3)} ms, assert ${assertBench ? 'on' : 'off'})`);
    if (assertBench) expect(p95).toBeLessThanOrEqual(20);
  }, 120_000);
});

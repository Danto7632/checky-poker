// A-SES-PRACTICE: createPracticeClient -> PracticeTableClient (US18). Practice runs on the same dealer Worker as a
// friend room, with transport 'none': no relay, no WebRTC, no fetch — and no net module in its static import graph
// (SS4-AC2, RL-07). The table starts dealing as soon as the client exists (US18 AC1: Start -> first deal).
//
//   session --W.INIT, W.CMD{cmd, c}--> Worker        Worker --W.OUT local {env}--> applyEnvelope -> snapshot
// Promise<Ack> methods carry a local correlation number `c`; the Worker answers H.ACK{c} / H.NACK{c, code}
// (S11-F02, D-P2). Every local env still goes through validateEnvelope('to_guest'), which is also the only way a
// received H.VIEW becomes a branded PlayerView here (D-P1) — the same path as a guest's bytes.
//
// The dealer Worker is the tab's shared one (shared-host.ts, R0-L12): a table leases it and gives it back when it
// ends — H.CLOSED (leave), dispose(), or a newer table taking it — with W.DISPOSE, never terminate(). A crash
// (error / messageerror / W.FATAL, or no W.DISPOSED within 2000 ms once the Worker runs — R0-L31, R0-L34) is the
// only path that kills it.
//
// Tests swap the Worker with the in-process port through createPracticeClientWith + createSharedHost (the index
// exports only createPracticeClient, so app code cannot pick a main-thread dealer).
import { ERROR_CODES, WORKER_OUTBOUND_TYPES, validateEnvelope, type BotSpec, type EngineAction, type ErrorCode, type TableConfig, type TurnSeconds } from '@checky/engine/protocol';
import { CheckyError } from '@checky/engine/util';
import { createClientStore, initialSnapshot } from './client-store';
import { createRecordSink } from './record-sink';
import { acquireTabHost, type HostLease, type SharedHost } from './shared-host';
import type { Ack, PracticeOptions, PracticeTableClient } from './types';

const PRACTICE_TURN_SECONDS: readonly TurnSeconds[] = [30, 60, null];
/** Practice rpk never leaves the Worker (not in views or records), so any constant works (story 1-1 F-1). */
const PRACTICE_RPK = 'practice';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isErrorCode = (v: unknown): v is ErrorCode => typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);

export function createPracticeClient(opts: PracticeOptions): PracticeTableClient {
  return createPracticeClientWith(opts, acquireTabHost);
}

/**
 * Throws CheckyError('E-ENG-INVALID-INIT') for 0 or more than 5 bots, or turnSeconds outside 30|60|null — checked
 * before the Worker is acquired, so a bad request never takes the Worker from a running table.
 */
export function createPracticeClientWith(opts: PracticeOptions, acquire: SharedHost['acquire']): PracticeTableClient {
  const { deps, profile } = opts;
  const d = deps.config.defaults;
  if (!Array.isArray(opts.bots) || opts.bots.length < 1 || opts.bots.length > 5) throw new CheckyError('E-ENG-INVALID-INIT');
  if (!PRACTICE_TURN_SECONDS.includes(opts.settings.turnSeconds)) throw new CheckyError('E-ENG-INVALID-INIT');

  const config: TableConfig = {
    kind: 'practice',
    transport: 'none',
    // seatCount is ours to decide: me + the bots, whatever the caller passed (M3A-15).
    settings: { ...opts.settings, seatCount: opts.bots.length + 1 },
    // Room language = the creator's UI language (SS27 rule 4).
    lang: profile.lang,
    nextHandDelayMs: d.DV5.nextHandMs,
    nextHandDelayWithRevealMs: d.DV5.withRevealMs,
    maxTimeoutStrikes: d.DV6,
    hostReconnectWaitMs: d.DV7,
    botThinkMs: d.DV25.thinkMs,
    llmDecisionTimeoutMs: d.DV9,
    chatMaxLen: d.DV12.maxLen,
    chatPerSec: d.DV12.perSec,
    botChatMaxLen: d.DV11.maxLen,
    thoughtMaxLen: d.DV13,
    botChatTail: d.DV14,
  };

  const store = createClientStore(initialSnapshot('ready'), () => Date.now());
  const sink = createRecordSink({ mode: 'practice', hands: deps.hands, config: deps.config });
  const pending = new Map<number, (ack: Ack) => void>();
  const closeWaiters: (() => void)[] = [];
  let nextC = 0;
  // No more port traffic for this table: every later command settles at once. The lease delivers nothing after
  // release or a crash, so the listeners below need no unsubscribe.
  let ended = false;

  const settleAll = (ack: Ack): void => {
    for (const resolve of pending.values()) resolve(ack);
    pending.clear();
  };
  const end = (ack: Ack): void => {
    ended = true;
    settleAll(ack);
    for (const r of closeWaiters.splice(0)) r();
  };
  /** The table is over (H.CLOSED, dispose, or revoked by a newer table): give the Worker back for the next room. */
  const release = (): void => {
    if (ended) return;
    end({ ok: false, code: 'E-ACT-STALE' });
    port.release();
  };
  /** Crash or W.FATAL: the shared host has already terminated and discarded the Worker. */
  const fail = (code: ErrorCode): void => {
    if (ended) return;
    store.patch((s) => ({ ...s, conn: { ...s.conn, stage: 'failed', error: code } }));
    end({ ok: false, code });
  };

  const port: HostLease = acquire(release);
  port.onMessage((raw) => {
    if (!isObj(raw) || typeof raw.t !== 'string' || !(WORKER_OUTBOUND_TYPES as readonly string[]).includes(raw.t)) {
      deps.config.debugLog('E-PROTO-MALFORMED');
      return;
    }
    switch (raw.t) {
      case 'W.OUT': {
        if (raw.to !== 'local') {
          // Guest-bound bytes cannot exist in practice (no transport); never read them (D29).
          deps.config.debugLog('E-ROOM-BAD-TRANSITION');
          return;
        }
        let env;
        try {
          env = validateEnvelope(raw.env, 'to_guest');
        } catch (e) {
          deps.config.debugLog(e instanceof CheckyError ? e.code : 'E-PROTO-MALFORMED');
          return;
        }
        if (env.t === 'H.ACK' || env.t === 'H.NACK') {
          const resolve = pending.get(env.b.c);
          pending.delete(env.b.c);
          resolve?.(env.t === 'H.ACK' ? { ok: true } : { ok: false, code: env.b.code });
          return;
        }
        store.applyEnvelope(env);
        if (env.t === 'H.VIEW') sink.onView(env.b.view);
        else if (env.t === 'H.CHAT') sink.onChat(env.b.line);
        else if (env.t === 'H.CLOSED') release(); // the room's last message: leave() resolves, the Worker is free
        return;
      }
      case 'W.ERROR':
        if (!isErrorCode(raw.code)) return;
        deps.config.debugLog(raw.code);
        if (raw.code === 'E-ENG-INVARIANT') {
          const code = raw.code;
          store.patch((s) => ({ ...s, alert: { code, atMs: Date.now() } }));
        }
        return;
      case 'W.FATAL':
        fail(isErrorCode(raw.code) ? raw.code : 'E-WORKER-CRASH');
        return;
      default:
        // W.BOT_REQ / W.BOT_CANCEL: LLM bridge is 3-1; R0 practice decides every bot inside the Worker.
        // (W.DISPOSED never gets here: the shared host consumes it.)
        deps.config.debugLog('E-ROOM-BAD-TRANSITION');
    }
  });
  port.onCrash(() => fail('E-WORKER-CRASH'));

  const send = (cmd: Parameters<HostLease['post']>[0]): void => {
    if (!ended) port.post(cmd);
  };
  const command = (cmd: Extract<Parameters<HostLease['post']>[0], { t: 'W.CMD' }>['cmd']): Promise<Ack> => {
    if (ended) return Promise.resolve({ ok: false, code: 'E-ACT-STALE' });
    nextC += 1;
    const c = nextC;
    return new Promise<Ack>((resolve) => {
      pending.set(c, resolve);
      port.post({ t: 'W.CMD', cmd, c });
    });
  };

  const testSeed = deps.config.getE2EHooks()?.testSeed;
  send({
    t: 'W.INIT',
    config,
    host: { rpk: PRACTICE_RPK, nick: profile.nickname, avatarSeed: profile.avatarSeed, lang: profile.lang },
    ...(testSeed === undefined ? {} : { testSeed }),
  });
  for (const bot of opts.bots) void command({ t: 'ADD_BOT', seat: null, bot: { ...bot } satisfies BotSpec });
  void command({ t: 'START' });

  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => store.subscribe(listener),
    act(action: EngineAction) {
      const view = store.getSnapshot().view;
      if (view?.hand == null || view.me.seat === null) return Promise.resolve({ ok: false, code: 'E-ACT-STALE' });
      return command({ t: 'ACT', handId: view.hand.handId, turnSeq: view.hand.turnSeq, action: { ...action, seat: view.me.seat } });
    },
    sit: (mode) => send({ t: 'W.CMD', cmd: { t: 'SIT', mode } }),
    refill: () => send({ t: 'W.CMD', cmd: { t: 'REFILL' } }),
    leave() {
      if (ended || store.getSnapshot().closed !== null) return Promise.resolve();
      const done = new Promise<void>((resolve) => closeWaiters.push(resolve));
      send({ t: 'W.CMD', cmd: { t: 'CLOSE', mode: 'now' } });
      return done;
    },
    cancelWait: () => undefined, // practice has no waiting list
    // Practice chat lands with table/chat (2-1/2-3); the Worker answers BAD_TRANSITION until then.
    chat: (text) => command({ t: 'CHAT', text }),
    inviteInfo: () => null,
    dispose: release,
    pause: () => send({ t: 'W.CMD', cmd: { t: 'PAUSE' } }),
    resume: () => send({ t: 'W.CMD', cmd: { t: 'RESUME' } }),
    // Implemented in the reducer by 3-1 (MA-R1-07); until then the Worker drops it (E-ROOM-BAD-TRANSITION).
    setOption: (opt) => send({ t: 'W.CMD', cmd: { t: 'SET_OPTION', ...opt } }),
  };
}

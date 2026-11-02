// The host Worker shell (ADR-0003, protocol.worker.v1): everything that runs inside the dealer Worker except the
// pure engine. worker.ts only wires this to `self`; tests drive it in-process (testing.ts).
//
// Per input: unseal hand+bot memory -> reduceTable -> execute effects (project, verify, post, timers, bots) -> seal.
// Inputs are queued and processed one at a time, so an effect that produces a new input (a rule-bot decision, a
// timer) never re-enters the reducer.
//
// One Worker serves many rooms in a tab (lead review 2, R0-L12): W.DISPOSE discards the room — table, sealed
// state, queue, timers, peers, the seeded test rng — and answers W.DISPOSED once; the next W.INIT opens a new room
// in the same Worker, so a new table needs no script fetch (offline practice). Only W.FATAL ends the Worker.
//
// Egress whitelist — the ONLY messages this shell posts (asserted by the capture test):
//   W.OUT {to:'local', env}        this device's viewer (host seat / practice / arena spectator), an object
//   W.OUT {to:[conn], bytes}       a guest's envelope as opaque UTF-8 bytes, transferred — made by emitToPeer only
//   W.BOT_REQ / W.BOT_CANCEL       LLM bots (3-1; none in R0)
//   W.FATAL {code}                 the Worker cannot continue
//   W.ERROR {code}                 non-fatal; the main thread shows E-ENG-INVARIANT as an alert, logs the rest
//   W.DISPOSED {}                  the room of the matching W.DISPOSE is gone; everything after it is the next room
// Worker code never calls debugLog: a Worker has its own module instance, so its ring buffer would never reach
// the diagnostics copy (T2-009). Codes travel to the main thread as W.ERROR instead.
import type { HandState } from '@checky/engine';
import { projectView, verifyView } from '@checky/engine/projection';
import {
  MAX_ENVELOPE_BYTES,
  encodeEnvelope,
  envelope,
  isHostCommand,
  type Envelope,
  type ErrorCode,
  type HostIdentity,
  type TableConfig,
  type WorkerOutbound,
} from '@checky/engine/protocol';
import { createTable, reduceTable, type Clock, type Effect, type TableInput, type TableState, type Viewer } from '@checky/engine/table';
import { CheckyError, createSeededRng, type Rng } from '@checky/engine/util';
import { buildBotInput, decideInWorker, defaultBrain, type BotBrain, type BotMemory, type Project } from './bot-bridge';
import { createCryptoRng, randomBytes as cryptoRandomBytes } from './crypto-rng';
import { createSealer } from './seal';
import { createTimers, type TimerPort } from './timers';

export type Post = (msg: WorkerOutbound, transfer?: Transferable[]) => void;

export interface ShellOptions {
  post: Post;
  /** flags.E2E: only E2E builds honour W.INIT.testSeed (R10, api.config.v1 e2e_hooks). */
  acceptTestSeed: boolean;
  timers?: TimerPort;
  clock?: Clock;
  randomBytes?: (n: number) => Uint8Array;
  /** Test seam for a deterministic run without testSeed. */
  rng?: Rng;
  /** Test seam (T-003 mutation test). Production always uses projectView. */
  project?: Project;
  brain?: BotBrain;
}

export interface Shell {
  handle(msg: unknown): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Codes that mean "this one message must not go out" rather than "the Worker is broken". */
const EXIT_BLOCKS: readonly ErrorCode[] = ['E-PROJ-LEAK-BLOCKED', 'E-PROJ-ARENA-DENIED'];

// ---------------------------------------------------------------------------------------------------------------
// The participant exit (D29, T-001, T2-007, T2-012)
// ---------------------------------------------------------------------------------------------------------------
export interface PeerExitOptions {
  post: Post;
  project: Project;
  table(): TableState | null;
  viewerOf(conn: string): Viewer | null;
  onError(code: ErrorCode): void;
}

/** What may be sent to a guest. A view is requested as {t:'H.VIEW'}: the exit itself projects it for that guest. */
export type PeerMessage = Exclude<Envelope, { t: 'H.VIEW' }> | { t: 'H.VIEW' };

export interface PeerExit {
  /**
   * The ONLY way guest-bound data leaves the Worker: (for H.VIEW) projectView for that connection's viewer ->
   * verifyView -> encodeEnvelope -> an exact-length ArrayBuffer posted as W.OUT{to:[conn], bytes} with transfer.
   * One encoding and one W.OUT per connection, because Envelope.s is per connection (T2-007).
   */
  emitToPeer(conn: string, msg: PeerMessage): void;
  /** s of the last H.VIEW sent to `conn` (H.HB.vs). */
  lastViewSeq(conn: string): number;
}

export function createPeerExit(o: PeerExitOptions): PeerExit {
  const seq = new Map<string, number>();
  const lastView = new Map<string, number>();
  return {
    emitToPeer(conn, msg) {
      let out: Envelope;
      if (msg.t === 'H.VIEW') {
        const table = o.table();
        const viewer = o.viewerOf(conn);
        if (table === null || viewer === null) return;
        try {
          const view = o.project(table, viewer);
          verifyView(view, table, viewer);
          out = envelope('H.VIEW', 0, { view });
        } catch (e) {
          if (e instanceof CheckyError && EXIT_BLOCKS.includes(e.code)) {
            o.onError(e.code);
            return;
          }
          throw e;
        }
      } else {
        out = msg;
      }
      const s = (seq.get(conn) ?? 0) + 1;
      const u8 = encodeEnvelope({ ...out, s } as Envelope);
      if (u8.byteLength > MAX_ENVELOPE_BYTES) {
        // Sender-side limit (T2-012): not sent, s not consumed, so H.HB.vs never points at a missing view.
        o.onError('E-PROTO-TOO-LARGE');
        return;
      }
      seq.set(conn, s);
      // Transfer needs a buffer of exactly the message length; copy only when the view does not own it whole.
      const bytes = u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : new Uint8Array(u8).buffer;
      o.post({ t: 'W.OUT', to: [conn], bytes }, [bytes]);
      if (out.t === 'H.VIEW') lastView.set(conn, s);
    },
    lastViewSeq: (conn) => lastView.get(conn) ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------------------------------------------
interface Sealed {
  hand: HandState | null;
  memory: BotMemory;
}

export function createShell(opts: ShellOptions): Shell {
  const post = opts.post;
  const timers = opts.timers ?? createTimers();
  const clock: Clock = opts.clock ?? { nowMs: () => performance.now() };
  const project: Project = opts.project ?? projectView;
  const brain = opts.brain ?? defaultBrain;
  const newSealer = () => createSealer(opts.randomBytes ?? cryptoRandomBytes);
  // A W.INIT testSeed replaces rng for its room only; every new room starts from this (crypto, or the test seam).
  const roomRng = (): Rng => opts.rng ?? createCryptoRng();
  // conn -> viewer for connected guests (filled by 2-1 seating); empty for practice and arena.
  const peers = new Map<string, Viewer>();
  const newExit = () =>
    createPeerExit({
      post,
      project,
      table: () => current,
      viewerOf: (conn) => peers.get(conn) ?? null,
      onError: (code) => post({ t: 'W.ERROR', code }),
    });

  // Room state: everything below is reset by resetRoom() (W.DISPOSE) and set again by the next W.INIT.
  let sealer = newSealer();
  let rng: Rng = roomRng();
  let table: TableState | null = null; // hand always null here; the real one is sealed
  let sealed: Uint8Array | null = null;
  let current: TableState | null = null; // plain, only while one input is processed
  let memory: { handId: string | null; bots: BotMemory } = { handId: null, bots: {} };
  let localSeq = 0;
  let exit = newExit();
  const queue: TableInput[] = [];
  // Worker state, not reset per room: the queue loop guard, and `stopped` — set by W.FATAL only (a fatal Worker is
  // terminated by the main thread, never reused).
  let draining = false;
  let stopped = false;

  const localViewer = (t: TableState): Viewer | null =>
    t.hostSeat !== null ? { kind: 'seat', seat: t.hostSeat } : t.config.kind === 'arena' ? { kind: 'arena' } : null;

  const postLocal = (env: Envelope): void => {
    localSeq += 1;
    post({ t: 'W.OUT', to: 'local', env: { ...env, s: localSeq } as Envelope });
  };

  // ponytail: one H.VIEW per input (no 16 ms coalescing window from ADR-0007), add a 16 ms flush timer if
  // friend-room bursts (several inputs within one frame) show up in the 2-1 Loopback benchmark.
  function sendLocalView(t: TableState): void {
    const viewer = localViewer(t);
    if (viewer === null) return;
    let view;
    try {
      view = project(t, viewer);
      verifyView(view, t, viewer);
    } catch (e) {
      if (e instanceof CheckyError && EXIT_BLOCKS.includes(e.code)) {
        post({ t: 'W.ERROR', code: e.code });
        return;
      }
      throw e;
    }
    postLocal(envelope('H.VIEW', 0, { view }));
  }

  function route(send: Effect & { t: 'SEND' }): void {
    const { to, env } = send;
    // The reducer never SENDs H.VIEW (views go through SEND_VIEWS); anything else is routed as is.
    if (env.t === 'H.VIEW') return;
    if (to === 'local' || to === 'all') postLocal(env);
    if (to === 'all') for (const conn of peers.keys()) exit.emitToPeer(conn, env);
    else if (to !== 'local') for (const conn of Array.isArray(to) ? to : [to]) exit.emitToPeer(conn, env);
  }

  function onBotRequest(t: TableState, reqId: string, seat: number): void {
    let decision = null;
    try {
      const input = buildBotInput(t, seat, memory.bots, project, brain, rng);
      decision = decideInWorker(input, brain, rng);
      if (decision === null) post({ t: 'W.ERROR', code: 'E-ACT-ILLEGAL' });
    } catch (e) {
      if (!(e instanceof CheckyError && EXIT_BLOCKS.includes(e.code))) throw e;
      post({ t: 'W.ERROR', code: e.code });
    }
    if (decision !== null && t.hand !== null) {
      (memory.bots[seat] ??= []).push({ street: t.hand.street, action: decision.action, amount: decision.amount ?? 0, thought: decision.reason });
    }
    queue.push({ t: 'BOT_DECISION', reqId, decision, code: null });
  }

  function execute(t: TableState, effects: Effect[]): void {
    for (const e of effects) {
      switch (e.t) {
        case 'SEND_VIEWS':
          sendLocalView(t);
          for (const conn of peers.keys()) exit.emitToPeer(conn, { t: 'H.VIEW' });
          break;
        case 'SEND':
          route(e);
          break;
        case 'TIMER_START':
          timers.start(e.id, e.ms, () => enqueue({ t: 'TIMER', id: e.id }));
          break;
        case 'TIMER_CANCEL':
          timers.cancel(e.id);
          break;
        case 'BOT_REQUEST':
          onBotRequest(t, e.reqId, e.seat);
          break;
        case 'ERROR':
          post({ t: 'W.ERROR', code: e.code });
          break;
        case 'CLOSE_TRANSPORT':
          // 2-1: tells the main thread to leave the room; practice and arena have no transport.
          break;
      }
    }
  }

  function step(input: TableInput): void {
    if (table === null) return;
    const open = sealed === null ? { hand: null, memory: {} } : (sealer.unseal(sealed) as Sealed);
    const plain: TableState = { ...table, hand: open.hand };
    memory.bots = open.memory;
    const r = reduceTable(plain, input, { rng, clock });
    current = r.table;
    const handId = current.hand?.handId ?? null;
    if (handId !== memory.handId) memory = { handId, bots: {} };
    try {
      execute(current, r.effects);
    } finally {
      const next = current;
      sealed = next.hand === null ? null : sealer.seal({ hand: next.hand, memory: memory.bots } satisfies Sealed, next.hand.handId);
      table = { ...next, hand: null };
      current = null;
    }
  }

  function enqueue(input: TableInput): void {
    if (stopped) return;
    queue.push(input);
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0 && !stopped) step(queue.shift()!);
    } catch {
      // An exception here is a bug with unknown state: the room cannot continue (E-WORKER-CRASH path).
      // No details are attached — they could contain state.
      fatal('E-WORKER-CRASH');
    } finally {
      draining = false;
    }
  }

  function fatal(code: ErrorCode): void {
    post({ t: 'W.FATAL', code });
    stopped = true;
    resetRoom();
  }

  /** Forget the room completely: a late timer, sealed hand, pad, seeded rng or peer sequence must not reach the next. */
  function resetRoom(): void {
    timers.cancelAll();
    queue.length = 0;
    table = null;
    sealed = null;
    current = null;
    memory = { handId: null, bots: {} };
    localSeq = 0; // the next room's client store starts from s = 1, as with a fresh Worker
    sealer = newSealer();
    rng = roomRng();
    peers.clear();
    exit = newExit();
  }

  function init(msg: Record<string, unknown>): void {
    if (table !== null) {
      post({ t: 'W.ERROR', code: 'E-ROOM-BAD-TRANSITION' });
      return;
    }
    if (opts.acceptTestSeed && typeof msg.testSeed === 'string' && msg.testSeed !== '') rng = createSeededRng(msg.testSeed);
    try {
      table = createTable(msg.config as TableConfig, (msg.host ?? null) as HostIdentity | null);
    } catch (e) {
      fatal(e instanceof CheckyError ? e.code : 'E-ENG-INVALID-INIT');
      return;
    }
    sendLocalView(table);
  }

  return {
    handle(msg) {
      if (stopped) return;
      if (!isObj(msg) || typeof msg.t !== 'string') {
        post({ t: 'W.ERROR', code: 'E-PROTO-MALFORMED' });
        return;
      }
      switch (msg.t) {
        case 'W.INIT':
          init(msg);
          return;
        case 'W.CMD': {
          // A malformed command is dropped here: inside the reducer it could throw a TypeError, which the queue
          // treats as an unknown-state bug (W.FATAL E-WORKER-CRASH) and the room would end (R0 m3).
          const cmd = msg.cmd;
          if (!isHostCommand(cmd)) {
            post({ t: 'W.ERROR', code: 'E-PROTO-MALFORMED' });
            // A W.CMD with c is always answered (protocol.worker.v1), or the caller's Promise<Ack> never settles.
            if (Number.isInteger(msg.c)) postLocal(envelope('H.NACK', 0, { c: msg.c as number, code: 'E-PROTO-MALFORMED' }));
            return;
          }
          enqueue(Number.isInteger(msg.c) ? { t: 'HOST_CMD', cmd, c: msg.c as number } : { t: 'HOST_CMD', cmd });
          return;
        }
        case 'W.DISPOSE':
          // Always answered, even with no room open: the main thread counts W.DISPOSE against W.DISPOSED to find
          // the boundary between the old room's late messages and the next room (FIFO in both directions).
          resetRoom();
          post({ t: 'W.DISPOSED' });
          return;
        default:
          // W.PEER_IN, W.PEER_GONE, W.ONLINE (2-1), W.BOT_RESULT, W.VISIBILITY (3-1), W.TICK (reserved): not in R0.
          post({ t: 'W.ERROR', code: 'E-ROOM-BAD-TRANSITION' });
      }
    },
  };
}

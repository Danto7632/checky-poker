// A-TBL-CREATE / A-TBL-REDUCE: the room state machine (SS4 practice part + SS9 + SS10, contract 1.0.4-p1).
//
// reduceTable(table, input, ctx) -> {table, effects} is pure: the shell owns timers, transport and sealing.
// Any input that is not a defined transition is DROPPED: the SAME table object comes back (state unchanged,
// deep-equal included) with an ERROR effect (E-ROOM-BAD-TRANSITION etc., silent) and, when the command carried a
// correlation number `c`, a local H.NACK{c, code}. Accepted commands with `c` get a local H.ACK{c}.
//
// Practice transitions (story 1-1 E-3 with the p1 changes F-JN-05 / W5-U2 and the lead's R0 decisions):
//   WAITING + START (>= 2 with chips)          -> IN_HAND              (< 2: E-ROOM-START-MIN-PLAYERS)
//   IN_HAND + PAUSE                            -> IN_HAND, paused (pending; the hand plays out, its timer runs)
//   IN_HAND(paused) + RESUME                   -> IN_HAND, pending pause cancelled (no notice)
//   hand ends with a pause pending             -> PAUSED + N-PAUSED (no countdown; hand/result stay)
//   BETWEEN_HANDS + PAUSE                      -> PAUSED + N-PAUSED at once (countdown cancelled)
//   PAUSED + RESUME / SIT in (>= 2 with chips) -> next hand + N-RESUMED (sits the sitting-out human back in;
//                                                 dropped while my stack is 0 — refill first, R0-L3)
//   any phase + SIT in while my stack is 0     -> dropped (R0-L16; the busted countdown included)
//   hand end (self/timeout) / countdown end (any reason), human SITTING_OUT -> PAUSED + N-PAUSED (W5-U2)
//   PAUSED (manual) + SIT out, SIT in          -> the SIT in resumes too (R0-L4: I sat back down myself)
//   IN_HAND + CLOSE after_hand -> CLOSING_AFTER_HAND -> CLOSED at hand end · IN_HAND + CLOSE now -> VOIDED, CLOSED
//   WAITING / BETWEEN_HANDS / PAUSED + CLOSE   -> CLOSED
//   CLOSED + anything, CLOSING_AFTER_HAND + CLOSE after_hand -> dropped (R0 m2)
// Friend rooms use the same PAUSE/RESUME rows (R0-L6) but not the sit-out rows (sitout_rule is practice only).
import { advanceRunout } from '../hand/runout';
import { applyActionWith } from '../hand/apply';
import { legalActions } from '../hand/legal';
import type { ErrorCode } from '../protocol/codes';
import { envelope } from '../protocol/envelope';
import type { HostCommand, HostIdentity, TableConfig } from '../protocol/messages';
import { BOT_ENGINES, BOT_STYLES, PROVIDER_IDS, type BotSpec, type RoomKind } from '../protocol/view-types';
import { CheckyError } from '../util/checky-error';
import {
  afterHand,
  closeRoom,
  countdownEnd,
  enterPaused,
  guardInvariant,
  notice,
  pausesAtHandEnd,
  startHand,
  voidRunningHand,
} from './between-hands';
import { maybeApplyBot } from './bots';
import { NEXT_HAND_TIMER, botTimerId, runoutTimerId } from './timers';
import { cloneTable, dealableSeats, humanSeats, type Effect, type ReduceCtx, type Reduced, type TableInput, type TableSeat, type TableState } from './state';

const TURN_SECONDS: Record<Exclude<RoomKind, 'arena'>, readonly (number | null)[]> = {
  friend: [15, 30, 60],
  practice: [30, 60, null],
};

const posInt = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n > 0;
const nonNegInt = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function validBotSpec(b: BotSpec): boolean {
  return (
    BOT_ENGINES.includes(b.engine) &&
    BOT_STYLES.includes(b.style) &&
    (b.provider === null || PROVIDER_IDS.includes(b.provider)) &&
    (b.model === null || (typeof b.model === 'string' && b.model.length <= 100)) &&
    typeof b.label === 'string' &&
    [...b.label].length >= 1 &&
    [...b.label].length <= 24
  );
}

/** A-TBL-CREATE. Throws CheckyError('E-ENG-INVALID-INIT') for any out-of-range setting (AF-01, RG1-M17-06). */
export function createTable(config: TableConfig, host: HostIdentity | null): TableState {
  const s = config.settings;
  const ok =
    ['friend', 'practice', 'arena'].includes(config.kind) &&
    ['p2p', 'none'].includes(config.transport) &&
    Number.isInteger(s.seatCount) &&
    s.seatCount >= 2 &&
    s.seatCount <= 6 &&
    posInt(s.sb) &&
    posInt(s.bb) &&
    s.bb >= s.sb &&
    posInt(s.startStack) &&
    (config.kind === 'arena' || TURN_SECONDS[config.kind].includes(s.turnSeconds)) &&
    nonNegInt(config.nextHandDelayMs) &&
    nonNegInt(config.nextHandDelayWithRevealMs) &&
    posInt(config.maxTimeoutStrikes) &&
    nonNegInt(config.botThinkMs[0]) &&
    nonNegInt(config.botThinkMs[1]) &&
    config.botThinkMs[0] <= config.botThinkMs[1] &&
    posInt(config.llmDecisionTimeoutMs) &&
    (host === null || (typeof host.rpk === 'string' && typeof host.nick === 'string' && Number.isInteger(host.avatarSeed)));
  if (!ok) throw new CheckyError('E-ENG-INVALID-INIT');

  const seats: (TableSeat | null)[] = Array.from({ length: s.seatCount }, () => null);
  if (host !== null) {
    seats[0] = {
      seat: 0,
      kind: 'human',
      rpk: host.rpk,
      nick: host.nick,
      avatarSeed: host.avatarSeed,
      isHost: true,
      status: 'ACTIVE',
      stack: s.startStack,
      strikes: 0,
      sitOutReason: null,
      connected: true,
      bot: null,
    };
  }
  return {
    config,
    // friend rooms open their relay first (OPENING, 2-1); practice and arena start WAITING.
    phase: config.kind === 'friend' ? 'OPENING' : 'WAITING',
    paused: false,
    closingAfterHand: false,
    locked: false,
    seats,
    hostSeat: host === null ? null : 0,
    buttonSeat: null,
    handNo: 0,
    handsPlayed: 0,
    hand: null,
    nowMs: 0,
    turnDeadline: null,
    turnTimerId: null,
    countdownDeadline: null,
    pendingBot: null,
    appliedActs: [],
    voidedHandId: null,
  };
}

const reject = (table: TableState, code: ErrorCode, c: number | undefined): Reduced => ({
  table,
  effects: [
    { t: 'ERROR', code },
    ...(c === undefined ? [] : [{ t: 'SEND' as const, to: 'local' as const, env: envelope('H.NACK', 0, { c, code }) }]),
  ],
});

class Rejected extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}
/** Drop the input: reduceTable returns the untouched original table. */
function no(code: ErrorCode = 'E-ROOM-BAD-TRANSITION'): never {
  throw new Rejected(code);
}

const actKey = (cmd: { handId: string; turnSeq: number; action: { seat: number } }): string =>
  `${cmd.handId}:${cmd.turnSeq}:${cmd.action.seat}`;

export function reduceTable(table: TableState, input: TableInput, ctx: ReduceCtx): Reduced {
  const c = input.t === 'HOST_CMD' ? input.c : undefined;
  // ACT idempotency (SS8 rule 4): the same (handId, turnSeq, seat) again is acknowledged and changes nothing.
  if (input.t === 'HOST_CMD' && input.cmd.t === 'ACT' && table.appliedActs.includes(actKey(input.cmd))) {
    return { table, effects: c === undefined ? [] : [{ t: 'SEND', to: 'local', env: envelope('H.ACK', 0, { c }) }] };
  }
  const t = cloneTable(table);
  // Whole ms (R0-L14): the shell clock is performance.now(), and with a fractional `now` the turn-start remaining
  // (now + 60000) - now is 60000.000000000007 in ~1 of 40 turns, which projection's ceil would show as 60001.
  t.nowMs = Math.floor(ctx.clock.nowMs());
  const fx: Effect[] = [];
  try {
    switch (input.t) {
      case 'HOST_CMD':
        command(t, fx, ctx, input.cmd);
        break;
      case 'TIMER':
        timer(t, fx, ctx, input.id);
        break;
      case 'BOT_DECISION': {
        const p = t.pendingBot;
        if (p === null || p.reqId !== input.reqId || p.arrived) no();
        p.arrived = true;
        p.decision = input.decision;
        if (input.code !== null) fx.push({ t: 'ERROR', code: input.code });
        maybeApplyBot(t, fx, ctx);
        break;
      }
    }
  } catch (e) {
    if (e instanceof Rejected) return reject(table, e.code, c);
    if (e instanceof CheckyError && e.code !== 'E-ENG-INVARIANT') return reject(table, e.code, c);
    throw e;
  }
  if (c !== undefined) fx.push({ t: 'SEND', to: 'local', env: envelope('H.ACK', 0, { c }) });
  fx.unshift({ t: 'SEND_VIEWS', to: 'all' });
  return { table: t, effects: fx };
}

function timer(t: TableState, fx: Effect[], ctx: ReduceCtx, id: string): void {
  const hand = t.hand;
  if (id === NEXT_HAND_TIMER) {
    if (t.phase !== 'BETWEEN_HANDS' || t.countdownDeadline === null) no();
    countdownEnd(t, fx, ctx);
    return;
  }
  if (hand !== null && id === runoutTimerId(hand.handId) && hand.street === 'RUNOUT') {
    guardInvariant(t, fx, () => {
      const r = advanceRunout(hand);
      t.hand = r.state;
      afterHand(t, fx, ctx, r.events);
    });
    return;
  }
  if (t.pendingBot !== null && id === botTimerId(t.pendingBot.reqId)) {
    t.pendingBot.thinkDone = true;
    maybeApplyBot(t, fx, ctx);
    return;
  }
  if (hand !== null && id === t.turnTimerId && hand.toAct !== null) {
    timeout(t, fx, ctx, hand.toAct);
    return;
  }
  // A timer for a turn, request or hand that is gone: nothing to do.
  no();
}

/** SS9: on timeout check if possible, else fold — never call or bet (G-8). Three in a row -> SITTING_OUT. */
function timeout(t: TableState, fx: Effect[], ctx: ReduceCtx, seatIdx: number): void {
  const hand = t.hand!;
  const seat = t.seats[seatIdx]!;
  const legal = legalActions(hand, seatIdx)!;
  fx.push({ t: 'ERROR', code: 'E-ACT-TIMEOUT' });
  guardInvariant(t, fx, () => {
    const r = applyActionWith(hand, { seat: seatIdx, type: legal.check ? 'check' : 'fold' }, 'timeout');
    seat.strikes += 1;
    if (seat.strikes >= t.config.maxTimeoutStrikes && seat.status !== 'SITTING_OUT') {
      seat.status = 'SITTING_OUT';
      seat.sitOutReason = 'timeout';
      if (seatIdx === t.hostSeat) notice(fx, 'N-SITOUT-STRIKES', { strikes: seat.strikes }, 'local');
    }
    t.hand = r.state;
    afterHand(t, fx, ctx, r.events);
  });
}

function hostSeat(t: TableState): TableSeat {
  const s = t.hostSeat === null ? null : t.seats[t.hostSeat];
  return s ?? no();
}

function command(t: TableState, fx: Effect[], ctx: ReduceCtx, cmd: HostCommand): void {
  const practice = t.config.kind === 'practice';
  // A closed room is final: no command may change it or produce a view (R0 m2).
  if (t.phase === 'CLOSED') no();
  switch (cmd.t) {
    case 'START': {
      if (t.phase !== 'WAITING') no();
      if (dealableSeats(t).length < 2) no('E-ROOM-START-MIN-PLAYERS');
      t.paused = false;
      startHand(t, fx, ctx);
      return;
    }
    case 'ADD_BOT': {
      if (t.phase === 'CLOSING_AFTER_HAND') no();
      if (!validBotSpec(cmd.bot)) no('E-ENG-INVALID-INIT');
      const free = cmd.seat === null ? t.seats.findIndex((s) => s === null) : t.seats[cmd.seat] === null ? cmd.seat : -1;
      if (free < 0 || free >= t.seats.length) no('E-ROOM-SEATS-FULL');
      t.seats[free] = {
        seat: free,
        kind: 'bot',
        rpk: null,
        nick: cmd.bot.label,
        avatarSeed: 1000 + free,
        isHost: false,
        // A bot added during a hand plays from the next hand (US29).
        status: t.phase === 'IN_HAND' ? 'WAITING_NEXT' : 'ACTIVE',
        stack: t.config.settings.startStack,
        strikes: 0,
        sitOutReason: null,
        connected: true,
        bot: { ...cmd.bot },
      };
      return;
    }
    case 'PAUSE': {
      if (t.phase === 'IN_HAND' && !t.paused) {
        t.paused = true;
        return;
      }
      if (t.phase === 'BETWEEN_HANDS') {
        if (pausesAtHandEnd(t)) {
          enterPaused(t, fx, true);
          return;
        }
        if (!t.paused) {
          t.paused = true; // arena (until 3-1's pause_rule.arena): takes effect when the countdown ends
          return;
        }
      }
      return no();
    }
    case 'RESUME': {
      if (t.phase === 'IN_HAND' && t.paused && pausesAtHandEnd(t)) {
        t.paused = false; // cancel the pending pause (F-JN-05, R0-L6)
        return;
      }
      if (t.phase !== 'PAUSED') no();
      resumeFromPause(t, fx, ctx);
      return;
    }
    case 'SIT': {
      const me = hostSeat(t);
      if (cmd.mode === 'out') {
        if (me.status === 'SITTING_OUT') no();
        me.status = 'SITTING_OUT';
        me.sitOutReason = 'self';
        return;
      }
      if (me.status !== 'SITTING_OUT') no();
      // R0-L16: no chips, no sitting in — in every phase and room kind (the countdown too: a busted me is
      // SITTING_OUT(bust) from hand end). Otherwise the next hand is dealt around a 0-chip seat, in practice a
      // bots-only hand that pauses again. REFILL (D-P12) is the only way back.
      if (me.stack === 0) no();
      if (t.phase === 'PAUSED' && practice) {
        // Covers the sit-out pause and, deliberately, a manual pause too (R0-L4).
        resumeFromPause(t, fx, ctx);
        return;
      }
      sitIn(me);
      return;
    }
    case 'REFILL': {
      const me = hostSeat(t);
      if (me.stack > 0 || t.phase === 'IN_HAND' || t.phase === 'CLOSING_AFTER_HAND') {
        no('E-ROOM-REFILL-NOT-ALLOWED');
      }
      me.stack = t.config.settings.startStack;
      // D-P12: a seat that sat out because it was busted is back from the next hand on.
      if (me.status === 'SITTING_OUT' && me.sitOutReason === 'bust') sitIn(me);
      return;
    }
    case 'CLOSE': {
      const running = t.phase === 'IN_HAND' || t.phase === 'CLOSING_AFTER_HAND';
      if (running && cmd.mode === 'after_hand') {
        if (t.closingAfterHand) no(); // already closing: no second N-CLOSING-AFTER-HAND (R0 m2)
        t.closingAfterHand = true;
        t.phase = 'CLOSING_AFTER_HAND';
        notice(fx, 'N-CLOSING-AFTER-HAND');
        return;
      }
      if (running) voidRunningHand(t, fx);
      closeRoom(t, fx, cmd.mode === 'now' && running ? 'host_closed_now' : 'host_closed');
      return;
    }
    case 'ACT': {
      const hand = t.hand;
      if (hand === null || (t.phase !== 'IN_HAND' && t.phase !== 'CLOSING_AFTER_HAND')) no('E-ACT-STALE');
      if (cmd.action.seat !== t.hostSeat) no('E-ACT-NOT-YOUR-TURN');
      if (cmd.handId !== hand.handId || cmd.turnSeq !== hand.turnSeq) no('E-ACT-STALE');
      // E-ACT-NOT-YOUR-TURN / E-ACT-ILLEGAL / E-ACT-AMOUNT propagate as CheckyError -> rejected, state unchanged.
      guardInvariant(t, fx, () => {
        const r = applyActionWith(hand, cmd.action, undefined);
        hostSeat(t).strikes = 0;
        t.appliedActs.push(actKey(cmd));
        t.hand = r.state;
        afterHand(t, fx, ctx, r.events);
      });
      return;
    }
    default:
      // LOCK, KICK, SET_BLINDS, SET_OPTION, UPDATE_BOT, REMOVE_BOT, CHAT: friend-room / 3-1 commands.
      return no();
  }
}

function sitIn(seat: TableSeat): void {
  seat.status = 'ACTIVE';
  seat.sitOutReason = null;
  seat.strikes = 0;
}

/**
 * PAUSED -> next hand, deal if >= 2 seats have chips. Practice only (sitout_rule, James Q2 / R0-L3): RESUME also
 * sits my sitting-out seat back in, and a busted me (stack 0) must refill first — dealing a bots-only hand would
 * just pause again. The screen shows the refill CTA instead of Resume in that state. In a friend room RESUME
 * never changes anyone's seat status: guests who sat out stay out until they sit in themselves.
 */
function resumeFromPause(t: TableState, fx: Effect[], ctx: ReduceCtx): void {
  if (t.config.kind === 'practice') {
    if (humanSeats(t).some((s) => s.stack === 0)) no();
    for (const s of humanSeats(t)) if (s.status === 'SITTING_OUT') sitIn(s);
  }
  if (dealableSeats(t).length < 2) no('E-ROOM-START-MIN-PLAYERS');
  t.paused = false;
  startHand(t, fx, ctx);
  // An E-ENG-INVARIANT while dealing leaves the room PAUSED with the alert: then nothing was resumed.
  if (t.phase !== 'PAUSED') notice(fx, 'N-RESUMED');
}


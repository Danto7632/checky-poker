// TableState, inputs and effects (api.engine.table.v1). One table = one room run by the host Worker.
//
// TableState holds no card outside `hand` (the HandState the shell seals between reducer calls, ADR-0003):
// seats, stacks, nicknames, rpk and timer deadlines are plain. Time never comes from a global clock: each input
// records ctx.clock.nowMs(), floored to whole ms, in `nowMs`; timers store absolute deadlines on that clock, and
// projection reports "deadline - nowMs" as the remaining ms — an int (api-contracts section 0: remaining time,
// never absolute time, on the wire; R0-L14).
import type { HandState } from '../hand/state';
import type { ErrorCode } from '../protocol/codes';
import type { Envelope, HostCommand, HostIdentity, TableConfig } from '../protocol/messages';
import type { BotSpec, EngineActionType, RoomPhase, SeatIndex, SeatStatus } from '../protocol/view-types';
import type { Rng } from '../util/rng';

export interface Clock {
  nowMs(): number;
}

/** Why a seat is SITTING_OUT: D-P12 brings a busted seat back automatically after a refill, the others not. */
export type SitOutReason = 'self' | 'timeout' | 'bust';

export interface TableSeat {
  seat: SeatIndex;
  kind: 'human' | 'bot';
  /** Room player key (humans). Never projected, never logged. */
  rpk: string | null;
  nick: string;
  avatarSeed: number;
  isHost: boolean;
  status: SeatStatus;
  stack: number;
  /** Consecutive turn timeouts (DV6). */
  strikes: number;
  sitOutReason: SitOutReason | null;
  connected: boolean;
  bot: BotSpec | null;
}

export interface PendingBot {
  reqId: string;
  seat: SeatIndex;
  handId: string;
  turnSeq: number;
  /** The decision arrives right away for rule bots (decided in the Worker) and later for LLM bots (3-1). */
  arrived: boolean;
  /** null after arrival = the request failed: the safe default (check, else fold) is played. */
  decision: TableBotDecision | null;
  /** The "thinking" delay (DV25) has elapsed. The decision is applied once both are true. */
  thinkDone: boolean;
}

/** The part of bot.io.v1 BotDecision the table needs (analysis owns the full type). */
export interface TableBotDecision {
  action: EngineActionType;
  amount: number | null;
}

export interface TableState {
  config: TableConfig;
  phase: RoomPhase;
  /** Pause requested (pending while a hand runs) or in effect (phase PAUSED). */
  paused: boolean;
  closingAfterHand: boolean;
  locked: boolean;
  /** length = settings.seatCount */
  seats: (TableSeat | null)[];
  hostSeat: SeatIndex | null;
  /** Button of the last dealt hand (the next hand moves it clockwise). */
  buttonSeat: SeatIndex | null;
  /** Hands dealt so far (HandView.no of the current hand). */
  handNo: number;
  /** Hands that reached COMPLETE (PlayerView.room.handsPlayed). */
  handsPlayed: number;
  /** Current or last hand. Plain only during a reducer call; the shell keeps it sealed otherwise. */
  hand: HandState | null;
  nowMs: number;
  turnDeadline: number | null;
  turnTimerId: string | null;
  countdownDeadline: number | null;
  pendingBot: PendingBot | null;
  /** (handId:turnSeq:seat) keys already applied this hand — ACT idempotency (SS8 rule 4). */
  appliedActs: string[];
  voidedHandId: string | null;
}

export type TableInput =
  | { t: 'HOST_CMD'; cmd: HostCommand; c?: number }
  | { t: 'TIMER'; id: string }
  | { t: 'BOT_DECISION'; reqId: string; decision: TableBotDecision | null; code: ErrorCode | null };

/**
 * Effects the shell executes. `SEND.env.s` is a placeholder: the shell stamps the per-recipient sequence number.
 * `to: 'local'` is this device's viewer (host seat / practice / arena spectator).
 */
export type Effect =
  | { t: 'SEND_VIEWS'; to: 'dirty' | 'all' }
  | { t: 'SEND'; to: 'local' | 'all' | string | string[]; env: Envelope }
  | { t: 'TIMER_START'; id: string; ms: number }
  | { t: 'TIMER_CANCEL'; id: string }
  | { t: 'BOT_REQUEST'; reqId: string; seat: SeatIndex; deadlineMs: number }
  | { t: 'CLOSE_TRANSPORT' }
  | { t: 'ERROR'; code: ErrorCode };

export interface ReduceCtx {
  rng: Rng;
  clock: Clock;
}

export interface Reduced {
  table: TableState;
  effects: Effect[];
}

export type Viewer = { kind: 'seat'; seat: SeatIndex } | { kind: 'waiting'; conn: string } | { kind: 'bot'; seat: SeatIndex } | { kind: 'arena' };

export type { HostIdentity };

/** Seats that can be dealt into the next hand: seated, not sitting out, with chips. */
export function dealableSeats(t: TableState): TableSeat[] {
  return t.seats.filter((s): s is TableSeat => s !== null && (s.status === 'ACTIVE' || s.status === 'WAITING_NEXT') && s.stack > 0);
}

export function humanSeats(t: TableState): TableSeat[] {
  return t.seats.filter((s): s is TableSeat => s !== null && s.kind === 'human');
}

/** Copy-on-write clone: seats are the only nested data the reducer edits in place. */
export function cloneTable(t: TableState): TableState {
  return {
    ...t,
    seats: t.seats.map((s) => (s === null ? null : { ...s })),
    appliedActs: [...t.appliedActs],
    pendingBot: t.pendingBot === null ? null : { ...t.pendingBot },
  };
}

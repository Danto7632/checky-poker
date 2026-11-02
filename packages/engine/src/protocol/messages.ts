// Message contracts: protocol.p2p.v1 (host <-> guest Envelope bodies) and protocol.worker.v1 (main thread <->
// host Worker), plus TableConfig and HostCommand (api-contracts sections 5-6).
//
// Host-only commands (start, pause, lock, kick, bots, blinds) are deliberately NOT P2P message types: a guest
// cannot even express them (trust_rules[2], US7 AC6). validateEnvelope rejects anything outside MESSAGE_TYPES.
import type { ErrorCode, NoticeCode } from './codes';
import type {
  BotSpec,
  ChatLine,
  EngineAction,
  Lang,
  Nickname,
  RoomKind,
  RoomSettings,
  RoomSummary,
  SeatIndex,
  SeatStatus,
  Transport,
} from './view-types';
import type { PlayerView } from '../projection/brand';

// ---------------------------------------------------------------------------------------------------------------
// protocol.p2p.v1
// ---------------------------------------------------------------------------------------------------------------
export const GUEST_MESSAGE_TYPES = [
  'G.PROBE',
  'G.HELLO',
  'G.ACT',
  'G.SIT',
  'G.REFILL',
  'G.LEAVE',
  'G.CANCEL_WAIT',
  'G.CHAT',
  'G.RESYNC',
  'G.HB',
] as const;
export const HOST_MESSAGE_TYPES = [
  'H.PROOF',
  'H.WELCOME',
  'H.REJECT',
  'H.VIEW',
  'H.ACK',
  'H.NACK',
  'H.CHAT',
  'H.NOTICE',
  'H.CLOSED',
  'H.HB',
] as const;
export const MESSAGE_TYPES = [...GUEST_MESSAGE_TYPES, ...HOST_MESSAGE_TYPES] as const;
export type GuestMessageType = (typeof GUEST_MESSAGE_TYPES)[number];
export type HostMessageType = (typeof HOST_MESSAGE_TYPES)[number];
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const REJECT_CODES = ['E-JOIN-FULL', 'E-JOIN-LOCKED', 'E-JOIN-KICKED', 'E-JOIN-VERSION', 'E-JOIN-OTHER-TAB'] as const;
export type RejectCode = (typeof REJECT_CODES)[number];

export interface MessageBodies {
  'G.PROBE': { n: string };
  'G.HELLO': { proto: string; rpk: string; nick: Nickname; avatarSeed: number; lang: Lang };
  'G.ACT': { handId: string; turnSeq: number; action: EngineAction };
  'G.SIT': { mode: 'out' | 'in' };
  'G.REFILL': Record<string, never>;
  'G.LEAVE': Record<string, never>;
  'G.CANCEL_WAIT': Record<string, never>;
  'G.CHAT': { text: string };
  'G.RESYNC': { last: number };
  'G.HB': Record<string, never>;
  'H.PROOF': { pub: string; sig: string };
  'H.WELCOME': { seat: SeatIndex | null; status: SeatStatus; reconnected: boolean };
  'H.REJECT': { code: RejectCode; hostProto: string };
  'H.VIEW': { view: PlayerView };
  'H.ACK': { c: number };
  'H.NACK': { c: number; code: ErrorCode };
  'H.CHAT': { line: ChatLine };
  'H.NOTICE': { code: NoticeCode; p: Record<string, unknown> };
  'H.CLOSED': { summary: RoomSummary };
  'H.HB': { vs: number };
}

/** PROTOCOL_MAJOR, the `v` of every Envelope (wire_format.version). */
export const ENVELOPE_VERSION = 1;

/** Discriminated union over `t`: `env.t === 'H.VIEW'` narrows `env.b` to `{view: PlayerView}`. */
export type Envelope<T extends MessageType = MessageType> = {
  [K in T]: { v: typeof ENVELOPE_VERSION; t: K; s: number; b: MessageBodies[K] };
}[T];

// ---------------------------------------------------------------------------------------------------------------
// protocol.worker.v1 — TableConfig and HostCommand
// ---------------------------------------------------------------------------------------------------------------
export interface TableConfig {
  kind: RoomKind;
  transport: Transport;
  settings: RoomSettings;
  lang: Lang;
  nextHandDelayMs: number;
  nextHandDelayWithRevealMs: number;
  maxTimeoutStrikes: number;
  hostReconnectWaitMs: number;
  botThinkMs: readonly [number, number];
  llmDecisionTimeoutMs: number;
  chatMaxLen: number;
  chatPerSec: number;
  botChatMaxLen: number;
  thoughtMaxLen: number;
  botChatTail: number;
  arenaSeats?: BotSpec[];
}

/** W.INIT.host: the identity of the person on this device (null for an arena spectator). */
export interface HostIdentity {
  rpk: string;
  nick: Nickname;
  avatarSeed: number;
  lang: Lang;
}

export type HostCommand =
  | { t: 'START' }
  | { t: 'PAUSE' }
  | { t: 'RESUME' }
  | { t: 'CLOSE'; mode: 'after_hand' | 'now' }
  | { t: 'LOCK'; on: boolean }
  | { t: 'KICK'; seat: SeatIndex }
  | { t: 'SET_BLINDS'; sb: number; bb: number }
  | { t: 'SET_OPTION'; liveEquity?: boolean; botChatter?: boolean }
  | { t: 'ADD_BOT'; seat: SeatIndex | null; bot: BotSpec }
  | { t: 'UPDATE_BOT'; seat: SeatIndex; bot: BotSpec }
  | { t: 'REMOVE_BOT'; seat: SeatIndex }
  | { t: 'ACT'; handId: string; turnSeq: number; action: EngineAction }
  | { t: 'SIT'; mode: 'out' | 'in' }
  | { t: 'REFILL' }
  | { t: 'CHAT'; text: string };

// ---------------------------------------------------------------------------------------------------------------
// protocol.worker.v1 — messages
// ---------------------------------------------------------------------------------------------------------------
/** Main thread -> Worker. W.BOT_RESULT carries an analysis BotDecision; the engine keeps it opaque. */
export type WorkerInbound =
  | { t: 'W.INIT'; config: TableConfig; host: HostIdentity | null; testSeed?: string }
  | { t: 'W.CMD'; cmd: HostCommand; c?: number }
  | { t: 'W.PEER_IN'; conn: string; env: unknown }
  | { t: 'W.PEER_GONE'; conn: string }
  | { t: 'W.BOT_RESULT'; reqId: string; decision: unknown; code: ErrorCode | null }
  | { t: 'W.ONLINE'; online: boolean }
  | { t: 'W.VISIBILITY'; hidden: boolean }
  | { t: 'W.DISPOSE' };

/**
 * Worker -> main thread. This union IS the egress whitelist (ADR-0003): nothing else may be posted.
 * The only object-shaped game data is `W.OUT local` (this device's viewer). Guest-bound data is opaque bytes.
 * W.BOT_REQ.input is the bot's own projection (BotInput, typed by host because the type lives in analysis).
 * W.DISPOSED (lead review 2, R0-L12, additive): posted once per W.DISPOSE, right after the room is discarded; the
 * Worker stays alive for the next W.INIT. It carries no data — it only marks the room boundary.
 */
export type WorkerOutbound =
  | { t: 'W.OUT'; to: 'local'; env: Envelope }
  | { t: 'W.OUT'; to: string[]; bytes: ArrayBuffer }
  | { t: 'W.BOT_REQ'; reqId: string; input: unknown; deadlineMs: number }
  | { t: 'W.BOT_CANCEL'; reqId: string }
  | { t: 'W.FATAL'; code: ErrorCode }
  | { t: 'W.ERROR'; code: ErrorCode }
  | { t: 'W.DISPOSED' };

export const WORKER_OUTBOUND_TYPES = ['W.OUT', 'W.BOT_REQ', 'W.BOT_CANCEL', 'W.FATAL', 'W.ERROR', 'W.DISPOSED'] as const;

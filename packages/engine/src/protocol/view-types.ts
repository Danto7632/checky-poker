// Contract types: enums.v1, types.core.v1 and types.player_view.v1 (api-contracts sections 2-4, contract 1.0.4-p1).
//
// Field names, optionality and nullability follow the contract one to one. Enumerations are declared as
// `as const` arrays first so validateEnvelope can check values at runtime with the same source of truth the
// types come from. `PlayerViewShape` is the unbranded structure; the branded `PlayerView` (the only thing that
// may leave the host, ADR-0002) is defined in projection/brand.ts and re-exported by the protocol index.

// ---------------------------------------------------------------------------------------------------------------
// enums.v1
// ---------------------------------------------------------------------------------------------------------------
export const ROOM_KINDS = ['friend', 'practice', 'arena'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export const TRANSPORTS = ['p2p', 'none'] as const;
export type Transport = (typeof TRANSPORTS)[number];

export const ROOM_PHASES = ['OPENING', 'WAITING', 'IN_HAND', 'BETWEEN_HANDS', 'PAUSED', 'CLOSING_AFTER_HAND', 'CLOSED'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

export const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'RUNOUT', 'SHOWDOWN', 'COMPLETE', 'VOIDED'] as const;
export type Street = (typeof STREETS)[number];

export const SEAT_STATUSES = ['CONNECTING', 'WAITING_NEXT', 'ACTIVE', 'SITTING_OUT', 'DISCONNECTED', 'LEFT', 'KICKED'] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const VIEWER_ROLES = ['host', 'player', 'waiting', 'spectator'] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

export const CONN_STAGES = [
  'idle',
  'opening_room',
  'finding_room',
  'connecting_host',
  'taking_seat',
  'ready',
  'reconnecting',
  'host_lost',
  'closed',
  'failed',
] as const;
export type ConnStage = (typeof CONN_STAGES)[number];

export const ACTION_TYPES = ['post_sb', 'post_bb', 'fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** The subset a player (or bot) may choose; blinds are posted by the engine. */
export const ENGINE_ACTION_TYPES = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const;
export type EngineActionType = (typeof ENGINE_ACTION_TYPES)[number];

export const AUTO_REASONS = ['timeout', 'leave', 'kick'] as const;
export type AutoReason = (typeof AUTO_REASONS)[number];

export const BOT_ENGINES = ['rule', 'llm'] as const;
export type BotEngine = (typeof BOT_ENGINES)[number];

export const BOT_STYLES = ['balanced', 'aggressive', 'tight'] as const;
export type BotStyle = (typeof BOT_STYLES)[number];

export const PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'local'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const LANGS = ['en', 'ja', 'ko'] as const;
export type Lang = (typeof LANGS)[number];

export const RECORD_MODES = ['practice', 'friend', 'arena', 'shared'] as const;
export type RecordMode = (typeof RECORD_MODES)[number];

export const CLOSE_REASONS = ['host_closed', 'host_closed_now', 'host_lost', 'worker_fatal'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const RANK_CODES = [
  'high_card',
  'pair',
  'two_pair',
  'trips',
  'straight',
  'flush',
  'full_house',
  'quads',
  'straight_flush',
] as const;
export type RankCode = (typeof RANK_CODES)[number];

export const EQUITY_METHODS = ['exact', 'mc'] as const;
export type EquityMethod = (typeof EQUITY_METHODS)[number];

export const CHAT_SYS_CODES = ['joined', 'left', 'removed'] as const;
export type ChatSysCode = (typeof CHAT_SYS_CODES)[number];

// ---------------------------------------------------------------------------------------------------------------
// types.core.v1
// ---------------------------------------------------------------------------------------------------------------
export const CARD_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const CARD_SUITS = ['s', 'h', 'd', 'c'] as const;
export type CardRank = (typeof CARD_RANKS)[number];
export type CardSuit = (typeof CARD_SUITS)[number];
/** Rank + lowercase suit, e.g. 'As', 'Td', '7c'. Inside the engine cards are integers 0..51. */
export type Card = `${CardRank}${CardSuit}`;

/** 0..seatCount-1 */
export type SeatIndex = number;

/** trim()ed, 1..16 code points (DV16). Checked with normalizeNickname at every boundary. */
export type Nickname = string;

export interface RankDetail {
  code: RankCode;
  /** Rank letters; order and count are fixed by `code` (see A-REC-RANK). No kickers. Wheel straight = '5'. */
  ranks: CardRank[];
}

export interface EngineAction {
  seat: SeatIndex;
  type: EngineActionType;
  /** Street total after the action. Required for bet, raise and allin; omitted for call (the engine computes it). */
  to?: number;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** amount = chips still to put in; to = my street total after calling. */
  call: null | { amount: number; to: number };
  /** In "to" terms. */
  bet: null | { min: number; max: number };
  /** minTo = currentBet + last raise increment of this street (BB when none, B-E4). */
  raise: null | { minTo: number; maxTo: number };
  allIn: { to: number };
  /** false after an under-raise all-in: raising is closed for this player (B-E6). */
  reopened: boolean;
}

export interface ActionLogEntry {
  i: number;
  street: Street;
  seat: SeatIndex;
  type: ActionType;
  to: number;
  added: number;
  auto?: AutoReason;
  fallback?: boolean;
}

export interface PotView {
  amount: number;
  eligible: SeatIndex[];
}

/** Allowed turnSeconds by room kind: friend 15|30|60, practice 30|60|null, arena unchecked (RG1-M17-06). */
export type TurnSeconds = 15 | 30 | 60 | null;

export interface RoomSettings {
  seatCount: number;
  sb: number;
  bb: number;
  startStack: number;
  turnSeconds: TurnSeconds;
  liveEquity: boolean;
  botChatter: boolean;
}

export interface BotSpec {
  engine: BotEngine;
  style: BotStyle;
  provider: ProviderId | null;
  model: string | null;
  label: string;
}

export interface ChatLine {
  id: string;
  seat: SeatIndex | null;
  name: string;
  kind: 'human' | 'bot' | 'system';
  text: string;
  sys?: null | { code: ChatSysCode; name: string };
  handId: string | null;
  /** Local time on the receiving device. */
  atMs: number;
}

export interface RoomSummary {
  reason: CloseReason;
  voidedHandId: string | null;
  handsPlayed: number;
  seats: { seat: SeatIndex; name: string; kind: 'human' | 'bot'; finalStack: number }[];
  settings: RoomSettings;
}

// ---------------------------------------------------------------------------------------------------------------
// types.player_view.v1
// ---------------------------------------------------------------------------------------------------------------
export interface BotInfo {
  engine: BotEngine;
  provider: ProviderId | null;
  model: string | null;
  label: string;
  style: BotStyle;
}

export interface OccupantInHand {
  bet: number;
  committed: number;
  folded: boolean;
  allIn: boolean;
  position: string;
  /** Revealed cards only (showdown from street SHOWDOWN on, finished bots, arena). Otherwise null. */
  cards: [Card, Card] | null;
  lastActionIndex: number | null;
}

export interface Occupant {
  kind: 'human' | 'bot';
  name: string;
  avatarSeed: number;
  isHost: boolean;
  isMe: boolean;
  status: SeatStatus;
  connected: boolean;
  stack: number;
  bot: BotInfo | null;
  inHand: OccupantInHand | null;
}

export interface SeatView {
  seat: SeatIndex;
  occupant: Occupant | null;
}

export interface HandView {
  /** 128-bit random id, 22 base64url characters. */
  handId: string;
  /** Hand number in this room, from 1. */
  no: number;
  street: Street;
  /** Dealt cards only (0, 3, 4 or 5). */
  board: Card[];
  buttonSeat: SeatIndex;
  sbSeat: SeatIndex;
  bbSeat: SeatIndex;
  pots: PotView[];
  currentBet: number;
  toAct: SeatIndex | null;
  /** +1 whenever the turn changes; the ACT idempotency key. */
  turnSeq: number;
  /** Remaining ms at send time; null = no clock (no-limit human turn, rule bot turn, toAct null). */
  turnMs: number | null;
  actions: ActionLogEntry[];
  startStacks: { seat: SeatIndex; stack: number }[];
}

export interface ResultPot {
  kind: 'main' | 'side';
  amount: number;
  eligible: SeatIndex[];
  winners: SeatIndex[];
  shares: number[];
}

export interface ShowdownEntry {
  seat: SeatIndex;
  cards: [Card, Card];
  rank: RankCode;
  best5: [Card, Card, Card, Card, Card];
}

export interface MetricsLite {
  equity: number;
  opponents: number;
  method: EquityMethod;
  samples: number | null;
  halfWidth95: number | null;
  exact: boolean;
  potOdds: null | [number, number];
  required: number | null;
  spr: number | null;
  position: string;
  inPosition: boolean | null;
}

export interface BotRevealDecision {
  actionIndex: number;
  street: Street;
  action: ActionType;
  amount: number;
  thought: string;
  metrics: MetricsLite | null;
  fallback: boolean;
  fallbackCode: string | null;
}

export interface BotReveal {
  seat: SeatIndex;
  name: string;
  engine: BotEngine;
  provider: ProviderId | null;
  model: string | null;
  style: BotStyle;
  holeCards: [Card, Card];
  decisions: BotRevealDecision[];
  chat: { actionIndex: number; text: string }[];
}

export interface HandResult {
  handId: string;
  pots: ResultPot[];
  returned: { seat: SeatIndex; amount: number }[];
  showdown: ShowdownEntry[];
  endStacks: { seat: SeatIndex; stack: number }[];
  botReveals: BotReveal[];
}

export interface ArenaView {
  bots: {
    seat: SeatIndex;
    holeCards: [Card, Card] | null;
    thoughts: { actionIndex: number; street: Street; text: string; fallback: boolean; metrics: MetricsLite | null }[];
  }[];
}

export interface PlayerViewRoom {
  kind: RoomKind;
  phase: RoomPhase;
  lang: Lang;
  settings: RoomSettings;
  pendingSettings: null | { sb: number; bb: number };
  locked: boolean;
  paused: boolean;
  closingAfterHand: boolean;
  handsPlayed: number;
  countdownMs: number | null;
  hostSeat: SeatIndex | null;
}

export interface PlayerViewMe {
  role: ViewerRole;
  seat: SeatIndex | null;
  status: SeatStatus | null;
  holeCards: [Card, Card] | null;
  legal: LegalActions | null;
  canRefill: boolean;
  timeoutStrikes: number;
}

/** The structure of a PlayerView without the brand. Only projection code may turn it into a PlayerView. */
export interface PlayerViewShape {
  pv: '1';
  room: PlayerViewRoom;
  me: PlayerViewMe;
  seats: SeatView[];
  hand: HandView | null;
  result: HandResult | null;
  arena: ArenaView | null;
}

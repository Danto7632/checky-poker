// @checky/engine/protocol — contract types, codes, version and the wire codec (api.engine.protocol.v1).
// The app may import this subpath, so every type the UI needs (RoomSettings, BotSpec, PlayerView...) is here.
export type * from './view-types';
export {
  ROOM_KINDS,
  TRANSPORTS,
  ROOM_PHASES,
  STREETS,
  SEAT_STATUSES,
  VIEWER_ROLES,
  CONN_STAGES,
  ACTION_TYPES,
  ENGINE_ACTION_TYPES,
  AUTO_REASONS,
  BOT_ENGINES,
  BOT_STYLES,
  PROVIDER_IDS,
  LANGS,
  RECORD_MODES,
  CLOSE_REASONS,
  RANK_CODES,
  EQUITY_METHODS,
  CHAT_SYS_CODES,
  CARD_RANKS,
  CARD_SUITS,
} from './view-types';
export type { PlayerView } from '../projection/brand';
export { ERROR_CODES, NOTICE_CODES } from './codes';
export type { ErrorCode, NoticeCode } from './codes';
export {
  MESSAGE_TYPES,
  GUEST_MESSAGE_TYPES,
  HOST_MESSAGE_TYPES,
  REJECT_CODES,
  ENVELOPE_VERSION,
  WORKER_OUTBOUND_TYPES,
} from './messages';
export type {
  MessageType,
  GuestMessageType,
  HostMessageType,
  RejectCode,
  MessageBodies,
  Envelope,
  TableConfig,
  HostIdentity,
  HostCommand,
  WorkerInbound,
  WorkerOutbound,
} from './messages';
export { PROTOCOL_VERSION } from './version';
export { envelope } from './envelope';
export { encodeEnvelope, decodeEnvelope } from './codec';
export { normalizeNickname } from '../util/nickname';
export { validateEnvelope, isHostCommand, MAX_ENVELOPE_BYTES } from './validate';

// A-PROTO-VALIDATE: the trust boundary for every decoded Envelope (both directions).
//
//   validateEnvelope(raw, 'to_host')  — what the host Worker accepts from a guest: G.* only
//   validateEnvelope(raw, 'to_guest') — what a guest accepts from the host: H.* only; H.VIEW is checked field by
//                                       field and branded through the projection-internal helper (D-P1)
//   isHostCommand(raw)                — the shape of a W.CMD command from this device's main thread. Not a trust
//                                       boundary (same origin), but a malformed command must be dropped as
//                                       E-PROTO-MALFORMED, not crash the reducer and end the room (R0 m3)
//
// Checks are exact: required keys present, optional keys valid when present, NO other keys (so nothing can be
// smuggled in an extra field, and `__proto__` keys from JSON.parse are rejected). Errors:
//   E-PROTO-TOO-LARGE    encoded size > 65,536 B (defence in depth — callers check byteLength before decoding)
//   E-PROTO-UNKNOWN-TYPE `t` is not a message of this direction (e.g. a host command like 'G.PAUSE')
//   E-PROTO-MALFORMED    anything else
// Semantic checks (nickname rules, chat length, whose turn) belong to the reducer, not here.
import { acceptReceivedView } from '../projection/receive';
import { CheckyError } from '../util/checky-error';
import { utf8Encode } from '../util/utf8';
import { ERROR_CODES, NOTICE_CODES } from './codes';
import {
  ENVELOPE_VERSION,
  GUEST_MESSAGE_TYPES,
  HOST_MESSAGE_TYPES,
  REJECT_CODES,
  type Envelope,
  type HostCommand,
  type MessageType,
} from './messages';
import {
  ACTION_TYPES,
  AUTO_REASONS,
  BOT_ENGINES,
  BOT_STYLES,
  CARD_RANKS,
  CARD_SUITS,
  CHAT_SYS_CODES,
  CLOSE_REASONS,
  ENGINE_ACTION_TYPES,
  EQUITY_METHODS,
  LANGS,
  PROVIDER_IDS,
  RANK_CODES,
  ROOM_KINDS,
  ROOM_PHASES,
  SEAT_STATUSES,
  STREETS,
  VIEWER_ROLES,
  type PlayerViewShape,
} from './view-types';

/** protocol.p2p.v1 limits.max_envelope_bytes (UTF-8 bytes of the encoded Envelope). */
export const MAX_ENVELOPE_BYTES = 65536;

// ---------------------------------------------------------------------------------------------------------------
// Tiny predicate combinators. Each returns true when the value has the contract shape.
// ---------------------------------------------------------------------------------------------------------------
type Check = (v: unknown) => boolean;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const int: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const nat: Check = (v) => int(v) && (v as number) >= 0;
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const unit: Check = (v) => num(v) && (v as number) >= 0 && (v as number) <= 1;
const bool: Check = (v) => typeof v === 'boolean';
const str: Check = (v) => typeof v === 'string';
const strMax =
  (n: number): Check =>
  (v) =>
    typeof v === 'string' && [...v].length <= n;
const oneOf =
  (values: readonly unknown[]): Check =>
  (v) =>
    values.includes(v);
const literal =
  (x: unknown): Check =>
  (v) =>
    v === x;
const nullable =
  (c: Check): Check =>
  (v) =>
    v === null || c(v);
const arrayOf =
  (c: Check, max = 1000): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(c);
const tuple =
  (...cs: Check[]): Check =>
  (v) =>
    Array.isArray(v) && v.length === cs.length && cs.every((c, i) => c(v[i]));
function obj(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (v) => {
    if (!isObj(v)) return false;
    // Object.hasOwn, not `in`: `'__proto__' in {}` is true through the prototype chain.
    for (const k of Object.keys(v)) if (!Object.hasOwn(required, k) && !Object.hasOwn(optional, k)) return false;
    for (const [k, c] of Object.entries(required)) if (!Object.hasOwn(v, k) || !c(v[k])) return false;
    for (const [k, c] of Object.entries(optional)) if (Object.hasOwn(v, k) && !c(v[k])) return false;
    return true;
  };
}

const card: Check = (v) =>
  typeof v === 'string' && v.length === 2 && (CARD_RANKS as readonly string[]).includes(v[0]!) && (CARD_SUITS as readonly string[]).includes(v[1]!);
const cards2 = tuple(card, card);
const seatIdx: Check = (v) => int(v) && (v as number) >= 0 && (v as number) < 6;
const seats = arrayOf(seatIdx, 6);
const empty = obj({});

// ---------------------------------------------------------------------------------------------------------------
// Shared contract types
// ---------------------------------------------------------------------------------------------------------------
const engineAction = obj({ seat: seatIdx, type: oneOf(ENGINE_ACTION_TYPES) }, { to: nat });
const legalActions = obj({
  fold: bool,
  check: bool,
  call: nullable(obj({ amount: nat, to: nat })),
  bet: nullable(obj({ min: nat, max: nat })),
  raise: nullable(obj({ minTo: nat, maxTo: nat })),
  allIn: obj({ to: nat }),
  reopened: bool,
});
const actionLog = obj(
  { i: nat, street: oneOf(STREETS), seat: seatIdx, type: oneOf(ACTION_TYPES), to: nat, added: nat },
  { auto: oneOf(AUTO_REASONS), fallback: bool },
);
const potView = obj({ amount: nat, eligible: seats });
const roomSettings = obj({
  seatCount: (v) => int(v) && (v as number) >= 2 && (v as number) <= 6,
  sb: nat,
  bb: nat,
  startStack: nat,
  turnSeconds: oneOf([15, 30, 60, null]),
  liveEquity: bool,
  botChatter: bool,
});
const botInfo = obj({
  engine: oneOf(BOT_ENGINES),
  provider: nullable(oneOf(PROVIDER_IDS)),
  model: nullable(strMax(100)),
  label: strMax(24),
  style: oneOf(BOT_STYLES),
});
const chatLine = obj(
  {
    id: strMax(64),
    seat: nullable(seatIdx),
    name: strMax(24),
    kind: oneOf(['human', 'bot', 'system']),
    text: strMax(200),
    handId: nullable(strMax(64)),
    atMs: num,
  },
  { sys: nullable(obj({ code: oneOf(CHAT_SYS_CODES), name: strMax(24) })) },
);
const metricsLite = obj({
  equity: unit,
  opponents: (v) => int(v) && (v as number) >= 1 && (v as number) <= 5,
  method: oneOf(EQUITY_METHODS),
  samples: nullable(nat),
  halfWidth95: nullable(unit),
  exact: bool,
  potOdds: nullable(tuple(nat, nat)),
  required: nullable(num),
  spr: nullable(num),
  position: strMax(16),
  inPosition: nullable(bool),
});
const botReveal = obj({
  seat: seatIdx,
  name: strMax(24),
  engine: oneOf(BOT_ENGINES),
  provider: nullable(oneOf(PROVIDER_IDS)),
  model: nullable(strMax(100)),
  style: oneOf(BOT_STYLES),
  holeCards: cards2,
  decisions: arrayOf(
    obj({
      actionIndex: nat,
      street: oneOf(STREETS),
      action: oneOf(ACTION_TYPES),
      amount: nat,
      thought: strMax(200),
      metrics: nullable(metricsLite),
      fallback: bool,
      fallbackCode: nullable(oneOf(ERROR_CODES)),
    }),
    200,
  ),
  chat: arrayOf(obj({ actionIndex: nat, text: strMax(120) }), 200),
});
const roomSummary = obj({
  reason: oneOf(CLOSE_REASONS),
  voidedHandId: nullable(strMax(64)),
  handsPlayed: nat,
  seats: arrayOf(obj({ seat: seatIdx, name: strMax(24), kind: oneOf(['human', 'bot']), finalStack: nat }), 6),
  settings: roomSettings,
});

const playerView: Check = obj({
  pv: literal('1'),
  room: obj({
    kind: oneOf(ROOM_KINDS),
    phase: oneOf(ROOM_PHASES),
    lang: oneOf(LANGS),
    settings: roomSettings,
    pendingSettings: nullable(obj({ sb: nat, bb: nat })),
    locked: bool,
    paused: bool,
    closingAfterHand: bool,
    handsPlayed: nat,
    countdownMs: nullable(nat),
    hostSeat: nullable(seatIdx),
  }),
  me: obj({
    role: oneOf(VIEWER_ROLES),
    seat: nullable(seatIdx),
    status: nullable(oneOf(SEAT_STATUSES)),
    holeCards: nullable(cards2),
    legal: nullable(legalActions),
    canRefill: bool,
    timeoutStrikes: nat,
  }),
  seats: arrayOf(
    obj({
      seat: seatIdx,
      occupant: nullable(
        obj({
          kind: oneOf(['human', 'bot']),
          name: strMax(24),
          avatarSeed: int,
          isHost: bool,
          isMe: bool,
          status: oneOf(SEAT_STATUSES),
          connected: bool,
          stack: nat,
          bot: nullable(botInfo),
          inHand: nullable(
            obj({
              bet: nat,
              committed: nat,
              folded: bool,
              allIn: bool,
              position: strMax(16),
              cards: nullable(cards2),
              lastActionIndex: nullable(nat),
            }),
          ),
        }),
      ),
    }),
    6,
  ),
  hand: nullable(
    obj({
      handId: strMax(64),
      no: nat,
      street: oneOf(STREETS),
      board: arrayOf(card, 5),
      buttonSeat: seatIdx,
      sbSeat: seatIdx,
      bbSeat: seatIdx,
      pots: arrayOf(potView, 6),
      currentBet: nat,
      toAct: nullable(seatIdx),
      turnSeq: nat,
      turnMs: nullable(nat),
      actions: arrayOf(actionLog, 500),
      startStacks: arrayOf(obj({ seat: seatIdx, stack: nat }), 6),
    }),
  ),
  result: nullable(
    obj({
      handId: strMax(64),
      pots: arrayOf(obj({ kind: oneOf(['main', 'side']), amount: nat, eligible: seats, winners: seats, shares: arrayOf(nat, 6) }), 6),
      returned: arrayOf(obj({ seat: seatIdx, amount: nat }), 6),
      showdown: arrayOf(obj({ seat: seatIdx, cards: cards2, rank: oneOf(RANK_CODES), best5: tuple(card, card, card, card, card) }), 6),
      endStacks: arrayOf(obj({ seat: seatIdx, stack: nat }), 6),
      botReveals: arrayOf(botReveal, 6),
    }),
  ),
  arena: nullable(
    obj({
      bots: arrayOf(
        obj({
          seat: seatIdx,
          holeCards: nullable(cards2),
          thoughts: arrayOf(
            obj({ actionIndex: nat, street: oneOf(STREETS), text: strMax(200), fallback: bool, metrics: nullable(metricsLite) }),
            200,
          ),
        }),
        6,
      ),
    }),
  ),
});

// ---------------------------------------------------------------------------------------------------------------
// Bodies per message type
// ---------------------------------------------------------------------------------------------------------------
const BODIES: Record<MessageType, Check> = {
  'G.PROBE': obj({ n: strMax(64) }),
  'G.HELLO': obj({ proto: strMax(16), rpk: strMax(64), nick: strMax(64), avatarSeed: int, lang: oneOf(LANGS) }),
  'G.ACT': obj({ handId: strMax(64), turnSeq: nat, action: engineAction }),
  'G.SIT': obj({ mode: oneOf(['out', 'in']) }),
  'G.REFILL': empty,
  'G.LEAVE': empty,
  'G.CANCEL_WAIT': empty,
  // Chat length (DV12) is the reducer's call (E-CHAT-TOO-LONG); here only a hard cap against abuse.
  'G.CHAT': obj({ text: strMax(2000) }),
  'G.RESYNC': obj({ last: nat }),
  'G.HB': empty,
  'H.PROOF': obj({ pub: strMax(128), sig: strMax(256) }),
  'H.WELCOME': obj({ seat: nullable(seatIdx), status: oneOf(SEAT_STATUSES), reconnected: bool }),
  'H.REJECT': obj({ code: oneOf(REJECT_CODES), hostProto: strMax(16) }),
  'H.VIEW': obj({ view: playerView }),
  'H.ACK': obj({ c: nat }),
  'H.NACK': obj({ c: nat, code: oneOf(ERROR_CODES) }),
  'H.CHAT': obj({ line: chatLine }),
  'H.NOTICE': obj({ code: oneOf(NOTICE_CODES), p: (v) => isObj(v) }),
  'H.CLOSED': obj({ summary: roomSummary }),
  'H.HB': obj({ vs: nat }),
};

// protocol.worker.v1 HostCommand, keyed by `t` so a new command is a compile error until it has a shape here.
const HOST_COMMANDS: Record<HostCommand['t'], Check> = {
  START: obj({ t: literal('START') }),
  PAUSE: obj({ t: literal('PAUSE') }),
  RESUME: obj({ t: literal('RESUME') }),
  CLOSE: obj({ t: literal('CLOSE'), mode: oneOf(['after_hand', 'now']) }),
  LOCK: obj({ t: literal('LOCK'), on: bool }),
  KICK: obj({ t: literal('KICK'), seat: seatIdx }),
  SET_BLINDS: obj({ t: literal('SET_BLINDS'), sb: nat, bb: nat }),
  SET_OPTION: obj({ t: literal('SET_OPTION') }, { liveEquity: bool, botChatter: bool }),
  ADD_BOT: obj({ t: literal('ADD_BOT'), seat: nullable(seatIdx), bot: botInfo }),
  UPDATE_BOT: obj({ t: literal('UPDATE_BOT'), seat: seatIdx, bot: botInfo }),
  REMOVE_BOT: obj({ t: literal('REMOVE_BOT'), seat: seatIdx }),
  ACT: obj({ t: literal('ACT'), handId: strMax(64), turnSeq: nat, action: engineAction }),
  SIT: obj({ t: literal('SIT'), mode: oneOf(['out', 'in']) }),
  REFILL: obj({ t: literal('REFILL') }),
  CHAT: obj({ t: literal('CHAT'), text: strMax(2000) }),
};

/** Shape only (ranges, labels and transitions are the reducer's checks). */
export function isHostCommand(raw: unknown): raw is HostCommand {
  if (!isObj(raw) || typeof raw.t !== 'string' || !Object.hasOwn(HOST_COMMANDS, raw.t)) return false;
  return HOST_COMMANDS[raw.t as HostCommand['t']](raw);
}

const DIRECTION: Record<'to_host' | 'to_guest', readonly string[]> = {
  to_host: GUEST_MESSAGE_TYPES,
  to_guest: HOST_MESSAGE_TYPES,
};

function encodedSize(raw: unknown): number {
  let text: string | undefined;
  try {
    text = JSON.stringify(raw);
  } catch {
    // BigInt, cycles (only possible from a structured clone) or a throwing toJSON.
    throw new CheckyError('E-PROTO-MALFORMED');
  }
  if (text === undefined) throw new CheckyError('E-PROTO-MALFORMED');
  return utf8Encode(text).length;
}

export function validateEnvelope(raw: unknown, dir: 'to_host' | 'to_guest'): Envelope {
  if (!isObj(raw)) throw new CheckyError('E-PROTO-MALFORMED');
  if (encodedSize(raw) > MAX_ENVELOPE_BYTES) throw new CheckyError('E-PROTO-TOO-LARGE');
  const { t } = raw;
  if (typeof t !== 'string' || !DIRECTION[dir].includes(t)) throw new CheckyError('E-PROTO-UNKNOWN-TYPE');
  const type = t as MessageType;
  const shape = obj({ v: literal(ENVELOPE_VERSION), t: literal(type), s: nat, b: BODIES[type] });
  if (!shape(raw)) throw new CheckyError('E-PROTO-MALFORMED');
  if (type === 'H.VIEW') {
    // D-P1: the only place a received view gets its brand.
    const body = raw.b as { view: PlayerViewShape };
    return { v: ENVELOPE_VERSION, t: 'H.VIEW', s: raw.s as number, b: { view: acceptReceivedView(body.view) } };
  }
  return raw as Envelope;
}

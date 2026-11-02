// record.hand.v1 types (data-model-erd section 4) and the replay frame (api.engine.record.v1).
//
// A HandRecordV1 is built ONLY from PlayerViews this device received (D12). It never contains another human's
// unrevealed cards, the deck, human chat, keys, rpk, the device secret or the room code (must_not_contain).
import type {
  ActionLogEntry,
  BotInfo,
  BotReveal,
  Card,
  Lang,
  PotView,
  ProviderId,
  RankCode,
  RecordMode,
  Street,
} from '../protocol/view-types';

export interface HandRecordV1 {
  v: 1;
  /** handId, or 'shared:' + hash for a shared record (filled by the share decoder). */
  id: string;
  handId: string;
  /** HandView.no; null for shared records. */
  no: number | null;
  /** ISO 8601 on this device. The builder leaves '' and session record-sink fills it right before hands.put. */
  playedAt: string;
  mode: RecordMode;
  lang: Lang;
  appVersion: string;
  table: { seatCount: number; sb: number; bb: number; buttonSeat: number; sbSeat: number; bbSeat: number };
  /** Seats that were dealt into this hand only. */
  seats: { seat: number; kind: 'me' | 'human' | 'bot'; name: string; bot: BotInfo | null; startStack: number }[];
  me: { seat: number | null; holeCards: [Card, Card] | null };
  actions: ActionLogEntry[];
  board: Card[];
  showdown: { seat: number; cards: [Card, Card]; rank: RankCode }[];
  pots: { kind: 'main' | 'side'; amount: number; eligible: number[]; winners: number[]; shares: number[] }[];
  returned: { seat: number; amount: number }[];
  endStacks: { seat: number; stack: number }[];
  botReveals: BotReveal[];
  botChat: { seat: number; actionIndex: number | null; text: string }[];
  coaching: null | {
    lang: Lang;
    provider: ProviderId;
    model: string;
    createdAt: string;
    items: { actionIndex: number; text: string; filtered: number }[];
  };
  shared: null | { importedAt: string; anonymized: true };
}

/** The denormalised list summary stored on each hands row (AP13). Not the same type as HandListItem (AF-11). */
export interface HandSummary {
  myPosition: string | null;
  myCards: [Card, Card] | null;
  /** endStack - startStack (refills are not part of a hand). */
  myNet: number | null;
  potTotal: number;
  botCount: number;
  hasThoughts: boolean;
}

/**
 * One replay step. Frame 0 is the table before any action (action null, blinds not yet posted); every
 * following frame is the state right after `actions[i - 1]`; board cards appear in the first frame of the
 * street that dealt them. `thought` is the acting bot's revealed thought for that action, if any.
 */
export interface ReplayFrame {
  i: number;
  street: Street;
  board: Card[];
  seats: { seat: number; stack: number; bet: number; folded: boolean; allIn: boolean; cards: [Card, Card] | null }[];
  pots: PotView[];
  action: ActionLogEntry | null;
  thought: string | null;
}

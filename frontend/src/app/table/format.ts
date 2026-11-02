// Display conversions for table screens (components.md sections 3.3, 3.9, 3.15, 5.3; ui-spec 0.5, 0.6).
//
// Everything here is a pure function of contract values, so the screen never computes poker rules: amounts and
// legal ranges come from view.me.legal, equity from DecisionMetrics/MetricsLite, hand categories from the engine's
// RankCode. The only arithmetic allowed on the screen is display arithmetic (pot sum, bet-sizer presets) and number
// formatting. 3-3 (CalcChips, ArenaMiniOdds) and 4-3 (CalcGrid, EstimateBadge) reuse equityDisplay and rankParts —
// do not re-implement them.
import type {
  Card,
  CardRank,
  CardSuit,
  EquityMethod,
  HandView,
  Lang,
  LegalActions,
  Occupant,
  PlayerView,
  RankCode,
  RoomPhase,
  RoomSettings,
  SeatView,
} from '@checky/engine/protocol';
import type { MessageKey } from '../i18n/en';

// ---------------------------------------------------------------------------------------------------------------
// Numbers (patterns section 9, G-6: numbers only, never a currency symbol)
// ---------------------------------------------------------------------------------------------------------------
const nf = (lang: Lang, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(lang, opts);

export function formatInt(n: number, lang: Lang): string {
  return nf(lang).format(n);
}

/**
 * Chip counts. `compact` (BetPill and seat stacks only) gives en "12.5k" from 10,000 up — lowercase k, ".0" dropped.
 * Intl's compact notation is not used: it prints "12.5K" and also shortens values below 10,000 (Node 24 measured).
 * ja always prints the full number with separators.
 */
export function formatChips(n: number, lang: Lang, compact = false): string {
  if (!compact || lang !== 'en' || n < 10_000) return formatInt(n, lang);
  // Round to one decimal in integer hundreds first so 12,350 -> 12.4k without float drift.
  return `${nf('en', { maximumFractionDigits: 1 }).format(Math.round(n / 100) / 10)}k`;
}

/** +2,400 / −1,200 (U+2212 minus) / 0 */
export function formatDelta(n: number, lang: Lang): string {
  if (n > 0) return `+${formatInt(n, lang)}`;
  if (n < 0) return `\u2212${formatInt(-n, lang)}`;
  return formatInt(0, lang);
}

/** A 0..1 ratio as a percent number with exactly one decimal, no "%" (the i18n template adds it). */
export function formatPercent1(ratio: number, lang: Lang): string {
  return nf(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ratio * 100);
}

/** Pot odds "2.5 : 1" (patterns section 9: one decimal, spaces around the colon). */
export function formatPotOdds(pot: number, call: number, lang: Lang): string {
  const ratio = nf(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pot / call);
  return `${ratio} : 1`;
}

// ---------------------------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------------------------
export interface ParsedCard {
  rank: CardRank;
  suit: CardSuit;
  /** What the face shows: "T" is drawn as "10". */
  face: string;
  red: boolean;
}

export function parseCard(card: Card): ParsedCard {
  const rank = card[0] as CardRank;
  const suit = card[1] as CardSuit;
  return { rank, suit, face: rank === 'T' ? '10' : rank, red: suit === 'h' || suit === 'd' };
}

const RANK_VALUE: Record<CardRank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

// ---------------------------------------------------------------------------------------------------------------
// Seats (components.md 3.3)
// ---------------------------------------------------------------------------------------------------------------
export type SeatVisualState =
  | 'waitingNext'
  | 'sittingOut'
  | 'reconnecting'
  | 'folded'
  | 'allIn'
  | 'thinking'
  | 'active';

/** A hand is being played (CLOSING_AFTER_HAND is a hand that closes the room when it ends — friend rooms). */
export function handInPlay(phase: RoomPhase): boolean {
  return phase === 'IN_HAND' || phase === 'CLOSING_AFTER_HAND';
}

/**
 * Order matters: the first matching row of the components.md table wins. `inPlay` = handInPlay(room.phase).
 * "All-in" is a betting state, so it shows only while the hand is played: between hands occupant.inHand still holds
 * the finished hand (allIn stays true after a shove) while occupant.stack is already the table stack, so a refilled
 * seat would read "10,000 · All-in" (R0-L15 / MS-R0-3 D6). "Folded" stays: it is still true of the shown result.
 */
export function seatVisualState(occupant: Occupant, isToAct: boolean, inPlay: boolean): SeatVisualState {
  if (occupant.status === 'WAITING_NEXT') return 'waitingNext';
  if (occupant.status === 'SITTING_OUT') return 'sittingOut';
  if (occupant.status === 'DISCONNECTED' || !occupant.connected) return 'reconnecting';
  if (occupant.inHand?.folded === true) return 'folded';
  if (occupant.inHand?.allIn === true && inPlay) return 'allIn';
  if (isToAct && occupant.kind === 'bot') return 'thinking';
  return 'active';
}

export interface TurnClock {
  remainingMs: number;
  totalMs: number;
}

/**
 * Whether a seat shows a turn ring, and its total (components.md 3.3 table, contract HandView.turnMs):
 *   not to act -> null · turnMs null (no-limit practice, rule bot, nobody to act) -> null · rule bot -> null ·
 *   LLM bot -> total DV9 · human with turnSeconds -> total turnSeconds*1000 · anything else (inconsistent) -> null.
 * The last row is the safe side: never draw a ring against an unknown total.
 */
export function seatTurnClock(
  seat: SeatView,
  hand: HandView | null,
  settings: RoomSettings,
  dv: { readonly DV9: number },
): TurnClock | null {
  const occupant = seat.occupant;
  if (hand === null || occupant === null || hand.toAct !== seat.seat) return null;
  if (hand.turnMs === null) return null;
  if (occupant.kind === 'bot') {
    if (occupant.bot?.engine === 'llm') return { remainingMs: hand.turnMs, totalMs: dv.DV9 };
    return null;
  }
  if (settings.turnSeconds !== null) return { remainingMs: hand.turnMs, totalMs: settings.turnSeconds * 1000 };
  return null;
}

/** I still hold live cards in a hand being played: leaving would fold them, so the screen asks first (patterns 4). */
export function inLiveHand(view: { room: { phase: RoomPhase }; hand: HandView | null; seats: readonly SeatView[] } | null): boolean {
  if (view === null || view.hand === null || view.room.phase !== 'IN_HAND') return false;
  if (view.hand.street === 'COMPLETE' || view.hand.street === 'VOIDED') return false;
  const me = view.seats.find((s) => s.occupant?.isMe)?.occupant;
  return me?.inHand !== null && me?.inHand !== undefined && !me.inHand.folded;
}

// ---------------------------------------------------------------------------------------------------------------
// Pause (components.md 3.15, contract pause_rule.practice 1.0.4-p1)
// ---------------------------------------------------------------------------------------------------------------
export type PauseState = 'running' | 'pending' | 'paused';

export function pauseState(paused: boolean, phase: RoomPhase): PauseState {
  if (phase === 'PAUSED') return 'paused';
  if (paused) return 'pending';
  return 'running';
}

/**
 * Practice stopped while my stack is 0 (lead decision R0-L3, components.md 3.15 `needsChips`): the engine drops
 * RESUME and SIT{in} until I refill (dealing a bots-only hand would only stop again), so no Resume is drawn anywhere
 * and the bottom slot's T-06 card is the one refill button (R0-L25; the menu sheet has its own refill row, P does
 * nothing). canRefill already means "stack 0 between hands". Friend rooms resume without me.
 */
export function mustRefill(view: Pick<PlayerView, 'room' | 'me'>): boolean {
  return view.room.kind === 'practice' && view.room.phase === 'PAUSED' && view.me.canRefill;
}

// ---------------------------------------------------------------------------------------------------------------
// Equity (ui-spec 0.5, contract MetricsLite.display_rule — exact shows no badge, T2-005)
// ---------------------------------------------------------------------------------------------------------------
export interface EquityInput {
  /** A record without the field counts as an estimate (rule 1). */
  method?: EquityMethod | null;
  value: number;
  halfWidth95: number | null;
  samples: number | null;
}

export interface EquityDisplay {
  exact: boolean;
  valueKey: 'odds.value.exact' | 'odds.value.mc';
  /** null for exact: no badge at all (T2-005). */
  badgeKey: 'odds.estimate' | 'odds.estimate.noHw' | null;
  srKey: 'odds.sr.exact' | 'odds.sr.mc' | 'odds.sr.mcNoHw';
  /** Only for estimates that carry a sample count. */
  tipKey: 'odds.estimate.tip' | null;
  vars: { v: string; hw?: string; samples?: string };
}

/**
 * Half-width in percent points, rounded UP to one decimal, ".0" dropped, minimum 0.1 (ui-spec 0.5 rule 3).
 * The value is scaled to an integer before the ceiling: Math.ceil(0.07 * 100 * 10) is 71 because
 * 0.07 * 1000 = 70.00000000000001 (IEEE 754), which would print 7.1 instead of 7.
 */
export function halfWidthPoints(halfWidth95: number): number {
  const tenths = Math.ceil(Math.round(halfWidth95 * 1e6) / 1e3);
  return Math.max(tenths, 1) / 10;
}

export function equityDisplay(m: EquityInput, lang: Lang): EquityDisplay {
  const v = formatPercent1(m.value, lang);
  if (m.method === 'exact') {
    return { exact: true, valueKey: 'odds.value.exact', badgeKey: null, srKey: 'odds.sr.exact', tipKey: null, vars: { v } };
  }
  const samples = m.samples === null ? undefined : formatInt(m.samples, lang);
  const tipKey = samples === undefined ? null : 'odds.estimate.tip';
  if (m.halfWidth95 === null) {
    return {
      exact: false,
      valueKey: 'odds.value.mc',
      badgeKey: 'odds.estimate.noHw',
      srKey: 'odds.sr.mcNoHw',
      tipKey: null,
      vars: samples === undefined ? { v } : { v, samples },
    };
  }
  const hw = nf(lang, { maximumFractionDigits: 1 }).format(halfWidthPoints(m.halfWidth95));
  return {
    exact: false,
    valueKey: 'odds.value.mc',
    badgeKey: 'odds.estimate',
    srKey: 'odds.sr.mc',
    tipKey,
    vars: samples === undefined ? { v, hw } : { v, hw, samples },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Hand ranks (ui-spec 0.6, AF-10)
// ---------------------------------------------------------------------------------------------------------------
export type RankKey = RankCode | 'royal_flush';

export interface RankParts {
  key: RankKey;
  r1?: CardRank;
  r2?: CardRank;
}

/**
 * Rank names for a showdown line, read from the engine's best5 (the contract gives no ranks on showdown entries).
 * Groups of equal rank are sorted by (size desc, rank desc): pair/two_pair/trips/full_house/quads read their
 * groups; straight and straight_flush read the top card (A-2-3-4-5 is a 5-high straight); flush and high_card read
 * the highest card. straight_flush to the ace is the royal flush. The category itself always comes from the
 * engine's code — this never decides what the hand is.
 */
export function rankParts(code: RankCode, best5: readonly Card[]): RankParts {
  const ranks = best5.map((c) => c[0] as CardRank);
  const counts = new Map<CardRank, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || RANK_VALUE[b[0]] - RANK_VALUE[a[0]]);
  const high = [...ranks].sort((a, b) => RANK_VALUE[b] - RANK_VALUE[a]);
  const top = high[0];
  if (top === undefined) return { key: code };

  switch (code) {
    case 'pair':
    case 'trips':
    case 'quads':
      return { key: code, r1: groups[0]![0] };
    case 'two_pair':
    case 'full_house':
      return { key: code, r1: groups[0]![0], r2: groups[1]![0] };
    case 'straight':
    case 'straight_flush': {
      const wheel = top === 'A' && ranks.includes('5') && ranks.includes('2');
      const r1: CardRank = wheel ? '5' : top;
      if (code === 'straight_flush' && r1 === 'A') return { key: 'royal_flush' };
      return { key: code, r1 };
    }
    case 'flush':
    case 'high_card':
      return { key: code, r1: top };
  }
}

/** The i18n variables of a rank line: r = singular rank name key, rs = plural (ui-spec 0.6). */
export function rankVarKeys(parts: RankParts): { r1?: MessageKey; r2?: MessageKey; rs1?: MessageKey; rs2?: MessageKey } {
  const out: { r1?: MessageKey; r2?: MessageKey; rs1?: MessageKey; rs2?: MessageKey } = {};
  if (parts.r1 !== undefined) {
    out.r1 = `rank.r.${parts.r1}`;
    out.rs1 = `rank.rs.${parts.r1}`;
  }
  if (parts.r2 !== undefined) {
    out.r2 = `rank.r.${parts.r2}`;
    out.rs2 = `rank.rs.${parts.r2}`;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Pot and bet sizing (components.md 3.6, 3.9 — display arithmetic only)
// ---------------------------------------------------------------------------------------------------------------
/** Pot shown on the felt = settled pots + bets in front of players (components.md 3.6). */
export function potTotal(hand: HandView | null, seats: readonly SeatView[]): number {
  if (hand === null) return 0;
  const pots = hand.pots.reduce((sum, p) => sum + p.amount, 0);
  const bets = seats.reduce((sum, s) => sum + (s.occupant?.inHand?.bet ?? 0), 0);
  return pots + bets;
}

export type SizerKind = 'raise' | 'bet';

export interface SizerRange {
  kind: SizerKind;
  min: number;
  max: number;
}

/** The bet sizer range comes from legal only: raise.{minTo,maxTo} or bet.{min,max}; null when neither exists. */
export function sizerRange(legal: LegalActions): SizerRange | null {
  if (legal.raise !== null && legal.reopened) return { kind: 'raise', min: legal.raise.minTo, max: legal.raise.maxTo };
  if (legal.bet !== null) return { kind: 'bet', min: legal.bet.min, max: legal.bet.max };
  return null;
}

/**
 * Whether All-in is a choice of its own (lead decision R0 M2): only when it puts in more than calling — or, with
 * nothing to call, more than my current bet. With raising closed (`reopened` false) the engine caps `allIn.to` at the
 * call, so Call already is that all-in and a second button would send the same thing (or "All-in 0" when checking).
 */
export function separateAllIn(legal: LegalActions, myBet: number): boolean {
  return legal.allIn.to > (legal.call?.to ?? myBet);
}

export interface Preset {
  id: 'min' | 'half' | 'threeQuarter' | 'pot';
  to: number;
}

/**
 * Pot-fraction presets: to = B + C + f x (P + C), or f x P when nobody has bet (B = my street bet, C = to call,
 * P = pot shown). Rounded, then dropped when below the minimum or at/above the maximum (that is All-in, which has
 * its own button). Min is always offered.
 */
export function sizerPresets(range: SizerRange, pot: number, myBet: number, toCall: number): Preset[] {
  const fractions: [Preset['id'], number][] = [
    ['half', 0.5],
    ['threeQuarter', 0.75],
    ['pot', 1],
  ];
  const facing = toCall > 0;
  const out: Preset[] = [{ id: 'min', to: range.min }];
  for (const [id, f] of fractions) {
    const to = Math.round(facing ? myBet + toCall + f * (pot + toCall) : f * pot);
    if (to > range.min && to < range.max) out.push({ id, to });
  }
  return out;
}

// HandState: the full truth of one hand — deck, every hole card, bets, contributions, log (api.engine.v1).
//
// It never leaves the host Worker except sealed (ADR-0003). Cards are integers 0..51 so a serialized state
// holds no card-shaped strings. Everything is plain JSON data (no Map/class) because the Worker serializes it
// for sealing between reducer calls. Functions in hand/** treat it as immutable and return new objects.
import type { ActionLogEntry, ResultPot, SeatIndex, Street } from '../protocol/view-types';
import type { HandRank } from '../cards/evaluator';

export interface HandSeatState {
  seat: SeatIndex;
  /** Chips behind (not yet in the pot). */
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in this hand, all streets (after uncalled returns). */
  committed: number;
  folded: boolean;
  allIn: boolean;
  hole: readonly [number, number];
  /** currentBet when this seat last acted voluntarily on this street; null = has not acted (blinds do not count). */
  actedLevel: number | null;
  lastActionIndex: number | null;
}

export interface ShowdownSeat {
  seat: SeatIndex;
  rank: HandRank;
  best5: number[];
}

export interface SettledResult {
  pots: ResultPot[];
  /** R12 order. Empty when the hand ended by folds. */
  showdown: ShowdownSeat[];
  endStacks: { seat: SeatIndex; stack: number }[];
}

export interface HandState {
  handId: string;
  sb: number;
  bb: number;
  buttonSeat: SeatIndex;
  sbSeat: SeatIndex;
  bbSeat: SeatIndex;
  /** Dealt seats only, ascending by seat index. */
  seats: HandSeatState[];
  startStacks: { seat: SeatIndex; stack: number }[];
  /** Undealt cards; the next board card is deck[0]. */
  deck: number[];
  board: number[];
  street: Street;
  currentBet: number;
  /** Increment of the last FULL bet/raise this street (BB when none) — the minimum raise increment (R3). */
  lastRaiseSize: number;
  toAct: SeatIndex | null;
  turnSeq: number;
  actions: ActionLogEntry[];
  /** Last seat that bet or raised on the current betting street; first to show at showdown (R12). */
  lastAggressor: SeatIndex | null;
  positions: Record<SeatIndex, string>;
  /** Uncalled excess handed back so far (R7). */
  returned: { seat: SeatIndex; amount: number }[];
  /** Set once the hand reaches COMPLETE. */
  result: SettledResult | null;
}

export const BETTING_STREETS: readonly Street[] = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'];

export function isBettingStreet(street: Street): boolean {
  return BETTING_STREETS.includes(street);
}

/** Copy deep enough for immutable updates (seats and arrays are the only mutable parts). */
export function cloneHand(s: HandState): HandState {
  return {
    ...s,
    seats: s.seats.map((p) => ({ ...p })),
    startStacks: s.startStacks.map((x) => ({ ...x })),
    deck: [...s.deck],
    board: [...s.board],
    actions: s.actions.map((a) => ({ ...a })),
    positions: { ...s.positions },
    returned: s.returned.map((r) => ({ ...r })),
    result: s.result,
  };
}

export function seatState(s: HandState, seat: SeatIndex): HandSeatState | undefined {
  return s.seats.find((p) => p.seat === seat);
}

/** Dealt seats in clockwise order starting with the first seat AFTER `from`. */
export function clockwiseAfter(s: HandState, from: SeatIndex): HandSeatState[] {
  const after = s.seats.filter((p) => p.seat > from);
  const before = s.seats.filter((p) => p.seat <= from);
  return [...after, ...before];
}

export const canAct = (p: HandSeatState): boolean => !p.folded && !p.allIn;

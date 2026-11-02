// A-ENG-CREATE-HAND: shuffle, post blinds AS ACTIONS (B-F2), deal two cards to every seat with chips.
//
// R9: seats with stack 0 are not dealt and post nothing. R1: heads-up the button is the small blind and acts
// first preflop; otherwise SB/BB are the next two dealt seats clockwise. A short blind posts what it has and is
// all-in; the price to call stays the full BB (TDA short all-in blind). If the blinds already leave at most one
// player able to act, the hand goes straight to the runout.
import { positionLabels } from '../cards/positions';
import { shuffledDeck } from '../cards/deck';
import type { SeatIndex } from '../protocol/view-types';
import { CheckyError } from '../util/checky-error';
import type { Rng } from '../util/rng';
import { advance } from './apply';
import type { EngineEvent } from './events';
import { clockwiseAfter, type HandSeatState, type HandState } from './state';

export interface HandInit {
  handId: string;
  seats: { seat: SeatIndex; stack: number }[];
  buttonSeat: SeatIndex;
  sb: number;
  bb: number;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

export function createHand(init: HandInit, rng: Rng): HandState {
  return createHandWithEvents(init, rng).state;
}

export function createHandWithEvents(init: HandInit, rng: Rng): { state: HandState; events: EngineEvent[] } {
  const { handId, sb, bb, buttonSeat } = init;
  if (typeof handId !== 'string' || handId.length === 0) throw new CheckyError('E-ENG-INVALID-INIT');
  if (!isCount(sb) || !isCount(bb) || sb < 1 || bb < sb) throw new CheckyError('E-ENG-INVALID-INIT');
  const seen = new Set<number>();
  for (const x of init.seats) {
    if (!isCount(x.seat) || !isCount(x.stack) || seen.has(x.seat)) throw new CheckyError('E-ENG-INVALID-INIT');
    seen.add(x.seat);
  }
  const dealt = init.seats.filter((x) => x.stack > 0).sort((a, b) => a.seat - b.seat);
  if (dealt.length < 2 || !dealt.some((x) => x.seat === buttonSeat)) throw new CheckyError('E-ENG-INVALID-INIT');

  const deck = shuffledDeck(rng);
  const seats: HandSeatState[] = dealt.map((x) => ({
    seat: x.seat,
    stack: x.stack,
    bet: 0,
    committed: 0,
    folded: false,
    allIn: false,
    hole: [deck.shift()!, deck.shift()!] as const,
    actedLevel: null,
    lastActionIndex: null,
  }));

  const s: HandState = {
    handId,
    sb,
    bb,
    buttonSeat,
    sbSeat: buttonSeat,
    bbSeat: buttonSeat,
    seats,
    startStacks: dealt.map((x) => ({ seat: x.seat, stack: x.stack })),
    deck,
    board: [],
    street: 'PREFLOP',
    currentBet: bb,
    lastRaiseSize: bb,
    toAct: null,
    turnSeq: 0,
    actions: [],
    lastAggressor: null,
    positions: positionLabels(dealt.map((x) => x.seat), buttonSeat),
    returned: [],
    result: null,
  };
  const ring = clockwiseAfter(s, buttonSeat);
  const sbP = dealt.length === 2 ? seats.find((p) => p.seat === buttonSeat)! : ring[0]!;
  const bbP = dealt.length === 2 ? ring[0]! : ring[1]!;
  s.sbSeat = sbP.seat;
  s.bbSeat = bbP.seat;

  const events: EngineEvent[] = [];
  const post = (p: HandSeatState, amount: number, type: 'post_sb' | 'post_bb'): void => {
    const paid = Math.min(amount, p.stack);
    p.stack -= paid;
    p.bet = paid;
    p.committed = paid;
    if (p.stack === 0) p.allIn = true;
    p.lastActionIndex = s.actions.length;
    s.actions.push({ i: s.actions.length, street: 'PREFLOP', seat: p.seat, type, to: paid, added: paid });
    events.push({ t: 'BlindPosted', seat: p.seat, amount: paid });
  };
  post(sbP, sb, 'post_sb');
  post(bbP, bb, 'post_bb');
  events.push({ t: 'HoleDealt', seats: seats.map((p) => p.seat) });

  // R2 preflop: first seat left of the BB that can act (heads-up that is the button/SB).
  const first = clockwiseAfter(s, bbP.seat).find((p) => !p.folded && !p.allIn);
  s.toAct = first ? first.seat : null;
  s.turnSeq = 1;
  // The blinds alone may already close the action (short all-in blinds): let the common closing logic decide.
  // `null` actor: if the street is still open the first actor above stays on turn.
  return { state: s, events: advance(s, events, null) };
}

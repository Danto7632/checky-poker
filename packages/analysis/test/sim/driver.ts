// Rule-bot simulation driver (MS-R0-2): real engine hands (createHand / legalActions / applyAction /
// advanceRunout, I-27), six rule bots, the button moving every hand, broke seats refilled.
//
// The bot view is built here from HandState for the acting seat only (its own hole cards, public log and board).
// projectView over a TableState exists now (I-11), but switching the 10,000-hand run to it was moved to 2-2 by the
// lead (R0 review 3.2 m5).
// ponytail: botView mirrors the projection by hand and can drift from it; on 2-2 day 1 (R1 start) drive the table
// with reduceTable and use projectView(table, {kind: 'bot', seat}) here.
//
// Legality is judged twice and never corrected (no nearestLegal): `illegalReason` against the LegalActions the
// bot was given, and the engine itself (applyAction throws E-ACT-* on an illegal action). A rejected decision is
// recorded and the hand is abandoned, so a failure is visible with its seed, hand number and action.
import { advanceRunout, applyAction, cardString, createHand, legalActions, type HandState } from '@checky/engine';
import type { BotStyle, EngineAction, LegalActions, PlayerView, PlayerViewShape } from '@checky/engine/protocol';
import { createSeededRng, type Rng } from '@checky/engine/util';
import type { BotDecision, BotInput } from '../../src/bot/contract';
import { decideRuleBot } from '../../src/bot/rule-bot';
import { computeMetrics } from '../../src/metrics/metrics';

export const SB = 50;
export const BB = 100;
export const START = 10_000;

/** null when legal; otherwise why not. Mirrors the engine's LegalActions reading (backend.md 0.1). */
export function illegalReason(d: BotDecision, legal: LegalActions): string | null {
  const int = (x: number | null): x is number => x !== null && Number.isInteger(x);
  switch (d.action) {
    case 'fold':
      return legal.fold ? null : 'fold not allowed';
    case 'check':
      return legal.check ? null : 'check not allowed';
    case 'call':
      return legal.call !== null && (d.amount === null || d.amount === legal.call.to) ? null : 'call not allowed';
    case 'bet':
      return legal.bet !== null && int(d.amount) && d.amount >= legal.bet.min && d.amount <= legal.bet.max ? null : 'bet out of range';
    case 'raise':
      return legal.raise !== null && int(d.amount) && d.amount >= legal.raise.minTo && d.amount <= legal.raise.maxTo ? null : 'raise out of range';
    case 'allin': {
      // The engine needs `to` and takes exactly allIn.to; more than the call needs raising open (R4).
      const isCall = legal.call !== null && legal.allIn.to <= legal.call.to;
      return d.amount === legal.allIn.to && (legal.reopened || isCall) ? null : 'all-in not allowed';
    }
  }
}

export function botView(state: HandState, seat: number, seatCount: number, legal: LegalActions): PlayerView {
  const me = state.seats.find((p) => p.seat === seat)!;
  const shape: PlayerViewShape = {
    pv: '1',
    room: {
      kind: 'practice',
      phase: 'IN_HAND',
      lang: 'en',
      settings: { seatCount, sb: SB, bb: BB, startStack: START, turnSeconds: null, liveEquity: true, botChatter: true },
      pendingSettings: null,
      locked: false,
      paused: false,
      closingAfterHand: false,
      handsPlayed: 0,
      countdownMs: null,
      hostSeat: null,
    },
    me: { role: 'player', seat, status: 'ACTIVE', holeCards: [cardString(me.hole[0]), cardString(me.hole[1])], legal, canRefill: false, timeoutStrikes: 0 },
    seats: Array.from({ length: seatCount }, (_, s) => {
      const p = state.seats.find((x) => x.seat === s);
      return {
        seat: s,
        occupant:
          p === undefined
            ? null
            : {
                kind: 'bot' as const,
                name: `Bot ${s}`,
                avatarSeed: s,
                isHost: false,
                isMe: s === seat,
                status: 'ACTIVE' as const,
                connected: true,
                stack: p.stack,
                bot: null,
                inHand: { bet: p.bet, committed: p.committed, folded: p.folded, allIn: p.allIn, position: state.positions[s] ?? '', cards: null, lastActionIndex: p.lastActionIndex },
              },
      };
    }),
    hand: {
      handId: state.handId,
      no: 1,
      street: state.street,
      board: state.board.map(cardString),
      buttonSeat: state.buttonSeat,
      sbSeat: state.sbSeat,
      bbSeat: state.bbSeat,
      pots: [],
      currentBet: state.currentBet,
      toAct: state.toAct,
      turnSeq: state.turnSeq,
      turnMs: null,
      actions: state.actions,
      startStacks: state.startStacks,
    },
    result: null,
    arena: null,
  };
  return shape as PlayerView;
}

export interface DecisionRecord {
  hand: number;
  seat: number;
  style: BotStyle;
  street: string;
  decision: BotDecision;
  legal: LegalActions;
}

export interface Failure {
  hand: number;
  seat: number;
  reason: string;
  decision: BotDecision;
  legal: LegalActions;
}

export interface SimResult {
  hands: number;
  decisions: number;
  failures: Failure[];
  /** Per seat: hands dealt in, hands with a voluntary preflop call/bet/raise/allin. */
  dealt: number[];
  vpip: number[];
}

/**
 * Plays `hands` hands at a 6-seat table. `seed` drives the deal (createHand) and, through a second stream, every
 * bot decision and Monte Carlo sample, so a run is reproducible from the seed alone.
 */
export function simulate(opts: { seed: string; hands: number; styles: readonly BotStyle[]; onDecision?: (r: DecisionRecord) => void }): SimResult {
  const seatCount = opts.styles.length;
  const dealRng = createSeededRng(`${opts.seed}/deal`);
  const botRng: Rng = createSeededRng(`${opts.seed}/bots`);
  const stacks = Array.from({ length: seatCount }, () => START);
  const dealt = Array.from({ length: seatCount }, () => 0);
  const vpip = Array.from({ length: seatCount }, () => 0);
  const failures: Failure[] = [];
  let decisions = 0;
  let button = 0;

  for (let h = 0; h < opts.hands; h += 1) {
    for (let s = 0; s < seatCount; s += 1) if (stacks[s]! < BB) stacks[s] = START; // free refill (D21)
    let state = createHand(
      { handId: `sim-${opts.seed}-${h}`, seats: stacks.map((stack, seat) => ({ seat, stack })), buttonSeat: button, sb: SB, bb: BB },
      dealRng,
    );
    for (const p of state.seats) dealt[p.seat]! += 1;
    const voluntary = new Set<number>();
    let abandoned = false;

    while (state.street !== 'COMPLETE' && !abandoned) {
      if (state.street === 'RUNOUT') {
        state = advanceRunout(state).state;
        continue;
      }
      const seat = state.toAct;
      const legal = seat === null ? null : legalActions(state, seat);
      if (seat === null || legal === null) throw new Error(`sim: no one to act on ${state.street}, hand ${h}, seed ${opts.seed}`);
      const view = botView(state, seat, seatCount, legal);
      const style = opts.styles[seat]!;
      const input: BotInput = {
        v: 1,
        seat,
        view,
        legal,
        metrics: computeMetrics(view, { precision: 'bot', rng: botRng }),
        style,
        lang: 'en',
        name: `Bot ${seat}`,
        model: null,
        chatTail: [],
        myPriorThoughts: [],
      };
      const decision = decideRuleBot(input, botRng);
      decisions += 1;
      opts.onDecision?.({ hand: h, seat, style, street: state.street, decision, legal });

      const reason = illegalReason(decision, legal);
      const action: EngineAction = decision.amount === null || decision.action === 'call' ? { seat, type: decision.action } : { seat, type: decision.action, to: decision.amount };
      try {
        if (reason !== null) throw new Error(reason);
        const street = state.street;
        state = applyAction(state, action).state;
        if (street === 'PREFLOP' && decision.action !== 'fold' && decision.action !== 'check') voluntary.add(seat);
      } catch (e) {
        failures.push({ hand: h, seat, reason: e instanceof Error ? e.message : String(e), decision, legal });
        abandoned = true;
      }
    }
    if (abandoned) continue; // stacks stay as they were; the failure is already recorded
    for (const s of voluntary) vpip[s]! += 1;
    for (const e of state.result?.endStacks ?? []) stacks[e.seat] = e.stack;
    // Next button: the next seat clockwise (every seat is refilled, so every seat is dealt in).
    button = (button + 1) % seatCount;
  }
  return { hands: opts.hands, decisions, failures, dealt, vpip };
}

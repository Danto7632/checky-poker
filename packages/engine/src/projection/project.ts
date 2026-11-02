// A-PROJ-VIEW: the single exit (ADR-0002, D7). Every byte of game data that leaves the host Worker — guest
// messages, the host's own screen, bot input, self records (built from views) — is a projectView result.
//
// Visibility (api-contracts section 4 table):
//   own hole cards          me.holeCards (seat and bot viewers; never in seats[me].inHand.cards during the hand)
//   showdown                from street SHOWDOWN on, every live seat's cards (R12, no muck); never during RUNOUT
//   bots after the hand     at COMPLETE every bot dealt in shows its cards, folded bots included (D16)
//   arena spectator         all bot cards, only when kind=arena, transport=none, no human seat (else DENIED)
//   never                   the deck, undealt board cards, folded or unshown human cards, rpk, keys
// A bot viewer gets exactly the seat view of its own seat (no other private information, SC9).
import { cardString } from '../cards/card';
import { rankLabel } from '../cards/evaluator';
import { legalActions } from '../hand/legal';
import { collectedPots } from '../hand/pots';
import type { HandState } from '../hand/state';
import type { Card, HandResult, HandView, Occupant, PlayerViewShape, SeatIndex } from '../protocol/view-types';
import type { TableState, Viewer } from '../table/state';
import { CheckyError } from '../util/checky-error';
import { brandView, type PlayerView } from './brand';

const pair = (h: readonly [number, number]): [Card, Card] => [cardString(h[0]), cardString(h[1])];

/** arena condition (SS30 / SS7-AC2): checked here and only here. */
export function arenaAllowed(t: TableState): boolean {
  return t.config.kind === 'arena' && t.config.transport === 'none' && t.hostSeat === null && t.seats.every((s) => s === null || s.kind === 'bot');
}

/** Seats whose cards everyone may see at this point of the hand. */
function revealedSeats(t: TableState): Set<SeatIndex> {
  const hand = t.hand;
  const out = new Set<SeatIndex>();
  if (hand === null) return out;
  if (hand.street === 'SHOWDOWN') for (const p of hand.seats) if (!p.folded) out.add(p.seat);
  if (hand.street === 'COMPLETE') {
    for (const x of hand.result?.showdown ?? []) out.add(x.seat);
    for (const p of hand.seats) if (t.seats[p.seat]?.kind === 'bot') out.add(p.seat);
  }
  return out;
}

/**
 * Whole ms left (turnMs, countdownMs are `int` in the contract — validateEnvelope rejects a fraction, R0-L14). The
 * host clock is performance.now(), so `deadline - now` is fractional; ceil keeps "time left" from showing as 0.
 * Example: deadline 60000.25, now 11583.45 -> 48417 (not 48416.8); deadline passed -> 0.
 */
function remaining(deadline: number | null, now: number): number | null {
  return deadline === null ? null : Math.ceil(Math.max(0, deadline - now));
}

function handView(t: TableState, hand: HandState): HandView {
  const toAct = hand.toAct;
  const humanTurn = toAct !== null && t.seats[toAct]?.kind === 'human';
  return {
    handId: hand.handId,
    no: t.handNo,
    street: hand.street,
    board: hand.board.map(cardString),
    buttonSeat: hand.buttonSeat,
    sbSeat: hand.sbSeat,
    bbSeat: hand.bbSeat,
    pots: hand.street === 'VOIDED' ? [] : collectedPots(hand),
    currentBet: hand.currentBet,
    toAct,
    turnSeq: hand.turnSeq,
    // Human turn: the turn timer (null when the room has no limit). Rule bot turn: no clock (AF-26).
    turnMs: humanTurn ? remaining(t.turnDeadline, t.nowMs) : null,
    actions: hand.actions.map((a) => ({ ...a })),
    startStacks: hand.startStacks.map((x) => ({ ...x })),
  };
}

function handResult(hand: HandState): HandResult {
  const r = hand.result!;
  return {
    handId: hand.handId,
    pots: r.pots.map((p) => ({ ...p, eligible: [...p.eligible], winners: [...p.winners], shares: [...p.shares] })),
    returned: hand.returned.map((x) => ({ ...x })),
    showdown: r.showdown.map((x) => {
      const p = hand.seats.find((s) => s.seat === x.seat)!;
      const best5 = x.best5.map(cardString) as [Card, Card, Card, Card, Card];
      return { seat: x.seat, cards: pair(p.hole), rank: rankLabel(x.rank), best5 };
    }),
    endStacks: r.endStacks.map((x) => ({ ...x })),
    // Assembled from sealed BotMemory by 3-1 (D16); R0 has none.
    botReveals: [],
  };
}

export function projectView(t: TableState, viewer: Viewer): PlayerView {
  if (viewer.kind === 'arena' && !arenaAllowed(t)) throw new CheckyError('E-PROJ-ARENA-DENIED');
  const meSeat = viewer.kind === 'seat' || viewer.kind === 'bot' ? viewer.seat : null;
  const hand = t.hand;
  const liveHand = hand !== null && hand.street !== 'VOIDED' ? hand : null;
  const revealed = revealedSeats(t);
  const arena = viewer.kind === 'arena';
  // A hand is being played (CLOSING_AFTER_HAND = IN_HAND that ends the room). Otherwise `liveHand` is only the
  // finished hand kept on screen (R0-L1), and stacks may have moved since: REFILL, D-P4 bot refill (R0-L15).
  const playing = t.phase === 'IN_HAND' || t.phase === 'CLOSING_AFTER_HAND';

  const seats = t.seats.map((s, seat) => {
    if (s === null) return { seat, occupant: null };
    const hp = liveHand?.seats.find((p) => p.seat === seat);
    const showCards = hp !== undefined && (revealed.has(seat) || (arena && s.kind === 'bot'));
    const occupant: Occupant = {
      kind: s.kind,
      name: s.nick,
      avatarSeed: s.avatarSeed,
      isHost: s.isHost,
      isMe: seat === meSeat,
      status: s.status,
      connected: s.connected,
      // While a hand is played the chips behind live in the hand state (table seats keep the start-of-hand stack);
      // otherwise the table seat stack, so a refill shows at once. inHand below keeps the finished hand's values.
      stack: playing && hp !== undefined ? hp.stack : s.stack,
      bot: s.bot === null ? null : { engine: s.bot.engine, provider: s.bot.provider, model: s.bot.model, label: s.bot.label, style: s.bot.style },
      inHand:
        hp === undefined
          ? null
          : {
              bet: hp.bet,
              committed: hp.committed,
              folded: hp.folded,
              allIn: hp.allIn,
              position: liveHand!.positions[seat] ?? '',
              cards: showCards ? pair(hp.hole) : null,
              lastActionIndex: hp.lastActionIndex,
            },
    };
    return { seat, occupant };
  });

  const mine = meSeat === null ? undefined : liveHand?.seats.find((p) => p.seat === meSeat);
  const meTable = meSeat === null ? null : t.seats[meSeat] ?? null;
  const betweenHands = t.phase === 'BETWEEN_HANDS' || t.phase === 'PAUSED' || t.phase === 'WAITING';
  const shape: PlayerViewShape = {
    pv: '1',
    room: {
      kind: t.config.kind,
      phase: t.phase,
      lang: t.config.lang,
      settings: { ...t.config.settings },
      pendingSettings: null,
      locked: t.locked,
      paused: t.paused,
      closingAfterHand: t.closingAfterHand,
      handsPlayed: t.handsPlayed,
      countdownMs: t.phase === 'BETWEEN_HANDS' ? remaining(t.countdownDeadline, t.nowMs) : null,
      hostSeat: t.hostSeat,
    },
    me: {
      role: viewer.kind === 'arena' ? 'spectator' : viewer.kind === 'waiting' ? 'waiting' : meSeat === t.hostSeat ? 'host' : 'player',
      seat: meTable === null ? null : meSeat,
      status: meTable?.status ?? null,
      holeCards: mine === undefined ? null : pair(mine.hole),
      legal: liveHand !== null && meSeat !== null && liveHand.toAct === meSeat ? legalActions(liveHand, meSeat) : null,
      canRefill: meTable !== null && meTable.stack === 0 && betweenHands,
      timeoutStrikes: meTable?.strikes ?? 0,
    },
    seats,
    hand: hand === null || t.phase === 'WAITING' ? null : handView(t, hand),
    // BETWEEN_HANDS and a PAUSED entered at hand end (F-JN-05); also CLOSED right after "close after this hand",
    // so the last hand still reaches the record builder (impl-notes reading R-1).
    result: hand !== null && hand.street === 'COMPLETE' && (t.phase === 'BETWEEN_HANDS' || t.phase === 'PAUSED' || t.phase === 'CLOSED') ? handResult(hand) : null,
    arena: arena
      ? {
          bots: t.seats.flatMap((s, seat) => {
            if (s === null || s.kind !== 'bot') return [];
            const hp = liveHand?.seats.find((p) => p.seat === seat);
            // thoughts come from sealed BotMemory (3-1).
            return [{ seat, holeCards: hp === undefined ? null : pair(hp.hole), thoughts: [] }];
          }),
        }
      : null,
  };
  return brandView(shape);
}

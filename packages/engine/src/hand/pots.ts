// Pots, uncalled bets and settlement (R7 side pots + returns, R8 odd chips, R12 show order, R11 conservation).
//
// Pots are layered by contribution level: for each distinct level L, every seat pays min(committed, L) minus
// what it paid into the lower layers; a layer is won among the non-folded seats that reached L. Consecutive
// layers with the same eligible seats are one pot. A layer no live seat reached exists only after force-folds
// (R13); no chip may disappear (R11):
//   - above a pot: it merges into the layer below (dead money goes to the highest pot a live seat reached; a
//     short all-in never wins chips above its own level);
//   - with no pot below (R0 M4): it is carried up to the next layer. Since a live seat that put anything in is
//     eligible from the lowest level up, this happens only when every live seat put in 0 (e.g. both blinds
//     force-folded before the button acted) — then nothing above has eligible seats either, and the carried
//     chips become one pot for the live seats (button wins the 150 in "SB and BB both leave").
import { bestFiveIndices, compareRanks, evaluateIndices } from '../cards/evaluator';
import type { PotView, ResultPot, SeatIndex } from '../protocol/view-types';
import { clockwiseAfter, type HandSeatState, type HandState, type ShowdownSeat, type SettledResult } from './state';
import type { EngineEvent } from './events';

interface Layer {
  amount: number;
  eligible: SeatIndex[];
}

function layers(seats: readonly HandSeatState[], amountOf: (p: HandSeatState) => number): Layer[] {
  const levels = [...new Set(seats.map(amountOf).filter((a) => a > 0))].sort((a, b) => a - b);
  const out: Layer[] = [];
  let prev = 0;
  let carried = 0;
  for (const level of levels) {
    let amount = 0;
    for (const p of seats) amount += Math.max(0, Math.min(amountOf(p), level) - prev);
    prev = level;
    const eligible = seats.filter((p) => !p.folded && amountOf(p) >= level).map((p) => p.seat);
    const below = out[out.length - 1];
    if (below === undefined && eligible.length === 0) {
      carried += amount;
      continue;
    }
    // A level created only by a folded player's contribution is not a new pot: same eligible set -> same pot
    // (G-2: 300 + 300 + BB's folded 100 is one 700 main pot).
    const sameSet = below !== undefined && below.eligible.length === eligible.length && below.eligible.every((x, i) => x === eligible[i]);
    if (below !== undefined && (eligible.length === 0 || sameSet)) below.amount += amount;
    else out.push({ amount: amount + carried, eligible });
    carried = 0;
  }
  if (carried > 0) out.push({ amount: carried, eligible: seats.filter((p) => !p.folded).map((p) => p.seat) });
  return out;
}

/** HandView.pots: chips from finished streets only (current-street bets are still in front of the players). */
export function collectedPots(s: HandState): PotView[] {
  return layers(s.seats, (p) => p.committed - p.bet);
}

/**
 * Hand back the part of the biggest street bet that nobody matched (R7). Mutates `s` (callers pass a clone) and
 * returns the event, or null. Called whenever a street closes and when the hand ends by folds. A folded
 * player's chips are dead money: a bettor who left (R13 force-fold) gets nothing back.
 */
export function returnUncalled(s: HandState): EngineEvent | null {
  const sorted = [...s.seats].sort((a, b) => b.bet - a.bet);
  const top = sorted[0];
  const second = sorted[1];
  if (top === undefined || second === undefined || top.folded || top.bet <= second.bet) return null;
  const amount = top.bet - second.bet;
  top.bet -= amount;
  top.committed -= amount;
  top.stack += amount;
  const prev = s.returned.find((r) => r.seat === top.seat);
  if (prev) prev.amount += amount;
  else s.returned.push({ seat: top.seat, amount });
  return { t: 'UncalledReturned', seat: top.seat, amount };
}

/** R12: last aggressor first if still in, else first non-folded seat left of the button; then clockwise. */
export function showOrder(s: HandState): SeatIndex[] {
  const live = s.seats.filter((p) => !p.folded).map((p) => p.seat);
  const start =
    s.lastAggressor !== null && live.includes(s.lastAggressor)
      ? s.lastAggressor
      : (clockwiseAfter(s, s.buttonSeat).find((p) => !p.folded)?.seat ?? s.buttonSeat);
  const asc = s.seats.map((p) => p.seat);
  const i = asc.indexOf(start);
  return [...asc.slice(i), ...asc.slice(0, i)].filter((seat) => live.includes(seat));
}

/**
 * Settle a finished hand: build layered pots from total contributions, award them (best hand among eligible,
 * ties split, odd chips one each from the first winner left of the button — R8), compute end stacks.
 * Mutates the stacks of `s` (callers pass a clone). `showdown` is false for a win by folds.
 */
export function settle(s: HandState, showdown: boolean): { result: SettledResult; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const order = showdown ? showOrder(s) : [];
  const shown: ShowdownSeat[] = order.map((seat) => {
    const p = s.seats.find((x) => x.seat === seat)!;
    const cards = [...p.hole, ...s.board];
    return { seat, rank: evaluateIndices(cards), best5: bestFiveIndices(cards) };
  });
  if (showdown) events.push({ t: 'Revealed', seats: order });

  const clockwise = clockwiseAfter(s, s.buttonSeat).map((p) => p.seat);
  const pots: ResultPot[] = layers(s.seats, (p) => p.committed).map((layer, index) => {
    let winners: SeatIndex[];
    if (layer.eligible.length === 1 || !showdown) {
      winners = layer.eligible.slice(0, 1);
    } else {
      const ranked = shown.filter((x) => layer.eligible.includes(x.seat));
      const best = ranked.reduce((a, b) => (compareRanks(b.rank, a.rank) > 0 ? b : a));
      winners = ranked.filter((x) => compareRanks(x.rank, best.rank) === 0).map((x) => x.seat);
    }
    winners.sort((a, b) => clockwise.indexOf(a) - clockwise.indexOf(b));
    const base = Math.floor(layer.amount / winners.length);
    const odd = layer.amount - base * winners.length;
    const shares = winners.map((_, i) => base + (i < odd ? 1 : 0));
    winners.forEach((seat, i) => {
      s.seats.find((p) => p.seat === seat)!.stack += shares[i]!;
    });
    events.push({ t: 'PotAwarded', index, winners, shares });
    return { kind: index === 0 ? 'main' : 'side', amount: layer.amount, eligible: layer.eligible, winners, shares };
  });

  return {
    result: { pots, showdown: shown, endStacks: s.seats.map((p) => ({ seat: p.seat, stack: p.stack })) },
    events,
  };
}

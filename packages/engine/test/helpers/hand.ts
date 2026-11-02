// Test helpers for driving hands deterministically: rig hole cards and the board into a fresh HandState (the
// W1 characterization harness did the same with `rig()`), act by seat, and run all-in runouts to the end.
import { cardIndex } from '../../src/cards/card';
import { applyAction } from '../../src/hand/apply';
import { createHand, type HandInit } from '../../src/hand/create';
import { advanceRunout } from '../../src/hand/runout';
import type { HandState } from '../../src/hand/state';
import type { Card, EngineAction } from '../../src/protocol/view-types';
import { createSeededRng } from '../../src/util/rng';
import type { EngineEvent } from '../../src/hand/events';

export const HAND_ID = 'testHandId0000000000AA';

export function newHand(stacks: Record<number, number>, buttonSeat: number, blinds: [number, number] = [50, 100], seed = 'golden'): HandState {
  const init: HandInit = {
    handId: HAND_ID,
    seats: Object.entries(stacks).map(([seat, stack]) => ({ seat: Number(seat), stack })),
    buttonSeat,
    sb: blinds[0],
    bb: blinds[1],
  };
  return createHand(init, createSeededRng(seed));
}

/** Replace hole cards and put `board` on top of the deck. Only valid before any board card is dealt. */
export function rig(s: HandState, hole: Record<number, [Card, Card]>, board: Card[]): HandState {
  const used = new Set<number>([...Object.values(hole).flat().map(cardIndex), ...board.map(cardIndex)]);
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));
  const seats = s.seats.map((p) => {
    const h = hole[p.seat];
    if (h) return { ...p, hole: [cardIndex(h[0]), cardIndex(h[1])] as const };
    // Seats without rigged cards get fresh cards that do not collide.
    return { ...p, hole: [rest.pop()!, rest.pop()!] as const };
  });
  return { ...s, seats, deck: [...board.map(cardIndex), ...rest], board: [] };
}

export interface Played {
  state: HandState;
  events: EngineEvent[];
}

export function act(s: HandState, seat: number, type: EngineAction['type'], to?: number): HandState {
  return play(s, seat, type, to).state;
}

export function play(s: HandState, seat: number, type: EngineAction['type'], to?: number): Played {
  return applyAction(s, to === undefined ? { seat, type } : { seat, type, to });
}

export function runout(s: HandState): HandState {
  let cur = s;
  for (let guard = 0; cur.street === 'RUNOUT' && guard < 5; guard += 1) cur = advanceRunout(cur).state;
  return cur;
}

/** Check/call whoever is on turn until the hand ends (runouts included). */
export function checkDown(s: HandState): HandState {
  let cur = s;
  for (let guard = 0; guard < 100; guard += 1) {
    if (cur.street === 'RUNOUT') cur = runout(cur);
    if (cur.toAct === null) return cur;
    const p = cur.seats.find((x) => x.seat === cur.toAct)!;
    cur = act(cur, p.seat, p.bet < cur.currentBet ? 'call' : 'check');
  }
  throw new Error('checkDown: no end');
}

export const stacksOf = (s: HandState): Record<number, number> =>
  Object.fromEntries((s.result?.endStacks ?? s.seats.map((p) => ({ seat: p.seat, stack: p.stack }))).map((x) => [x.seat, x.stack]));

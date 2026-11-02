// A-ENG-ADVANCE-RUNOUT: deal the rest of the board one street at a time during an all-in runout (R6).
// The pacing (450 ms before the first street, 700 ms between the next ones) belongs to the table timers; this
// function only deals. After the river it settles the showdown (COMPLETE). Cards stay hidden while the street
// is RUNOUT (D-P10): projection reveals them from SHOWDOWN/COMPLETE on.
import { CheckyError } from '../util/checky-error';
import { dealBoard, finish, type Applied } from './apply';
import type { EngineEvent } from './events';
import { cloneHand, type HandState } from './state';

export function advanceRunout(state: HandState): Applied {
  if (state.street !== 'RUNOUT') throw new CheckyError('E-ENG-INVARIANT');
  const s = cloneHand(state);
  const events: EngineEvent[] = [];
  const count = s.board.length === 0 ? 3 : 1;
  dealBoard(s, count);
  events.push({ t: 'StreetDealt', street: s.board.length === 3 ? 'FLOP' : s.board.length === 4 ? 'TURN' : 'RIVER', count });
  if (s.board.length === 5) finish(s, events, true);
  return { state: s, events };
}

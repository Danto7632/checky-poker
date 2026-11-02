// HandSummary for the hands row (data-model AP13: denormalised at write time so the list never replays actions).
// The record stores no positions, so my position is recomputed from the dealt seats and the button with the
// same label function the table used (A-ENG-POSITIONS).
import { positionLabels } from '../cards/positions';
import type { HandRecordV1, HandSummary } from './types';

export function summarizeRecord(rec: HandRecordV1): HandSummary {
  const me = rec.me.seat;
  const start = rec.seats.find((s) => s.seat === me)?.startStack;
  const end = rec.endStacks.find((s) => s.seat === me)?.stack;
  const dealt = rec.seats.map((s) => s.seat);
  const positions = me !== null && dealt.includes(rec.table.buttonSeat) ? positionLabels(dealt, rec.table.buttonSeat) : {};
  return {
    myPosition: me === null ? null : (positions[me] ?? null),
    myCards: rec.me.holeCards,
    myNet: start === undefined || end === undefined ? null : end - start,
    potTotal: rec.pots.reduce((a, p) => a + p.amount, 0),
    botCount: rec.seats.filter((s) => s.kind === 'bot').length,
    hasThoughts: rec.botReveals.some((r) => r.decisions.some((d) => d.thought.length > 0)),
  };
}

// A-REC-REPLAY: re-run a hand from its record alone with the engine rules (SS23 rule 7). The share decoder uses
// verifyReplay as its consistency check (C8), and the replay screen steps through replayFrames.
//
// Hidden information is not needed: pots, returns and stacks follow from the logged contributions, and the only
// cards that decide anything (the board and the showdown hands) are in the record. Seats whose cards were never
// shown get placeholder cards that cannot collide; if such a seat would reach showdown the record is
// inconsistent and verifyReplay says so.
//
// Frames: frame 0 is the table before the blinds (action null); then one frame per logged action, showing the
// board of that action's street; a deal frame (action null) whenever new board cards appear (next street or
// runout); and a final COMPLETE frame whose stacks are the record's endStacks.
import { cardIndex, cardString } from '../cards/card';
import { rankLabel } from '../cards/evaluator';
import { applyActionWith, forceFold } from '../hand/apply';
import { createHand } from '../hand/create';
import { collectedPots } from '../hand/pots';
import { advanceRunout } from '../hand/runout';
import type { HandState } from '../hand/state';
import type { ActionLogEntry, Card, EngineAction, Street } from '../protocol/view-types';
import { createSeededRng } from '../util/rng';
import type { HandRecordV1, ReplayFrame } from './types';

const BOARD_AT: Record<string, number> = { PREFLOP: 0, FLOP: 3, TURN: 4, RIVER: 5 };
const STREET_OF_BOARD: Street[] = ['PREFLOP', 'PREFLOP', 'PREFLOP', 'FLOP', 'TURN', 'RIVER'];

class Mismatch extends Error {}
const fail = (what: string): never => {
  throw new Mismatch(what);
};

function knownCards(rec: HandRecordV1): Map<number, [Card, Card]> {
  const known = new Map<number, [Card, Card]>();
  if (rec.me.seat !== null && rec.me.holeCards !== null) known.set(rec.me.seat, rec.me.holeCards);
  for (const s of rec.showdown) known.set(s.seat, s.cards);
  for (const b of rec.botReveals) known.set(b.seat, b.holeCards);
  return known;
}

function simulate(rec: HandRecordV1): { frames: ReplayFrame[]; final: HandState } {
  const known = knownCards(rec);
  const used = new Set<number>([...rec.board.map(cardIndex), ...[...known.values()].flat().map(cardIndex)]);
  if (used.size !== rec.board.length + known.size * 2) fail('duplicate cards');
  const pool = Array.from({ length: 52 }, (_, i) => i).filter((c) => !used.has(c));

  let s = createHand(
    {
      handId: rec.handId,
      seats: rec.seats.map((x) => ({ seat: x.seat, stack: x.startStack })),
      buttonSeat: rec.table.buttonSeat,
      sb: rec.table.sb,
      bb: rec.table.bb,
    },
    createSeededRng(0),
  );
  // Put the recorded cards in place: known hands, placeholders for the rest, the board on top of the deck.
  s = {
    ...s,
    seats: s.seats.map((p) => {
      const k = known.get(p.seat);
      return { ...p, hole: k ? ([cardIndex(k[0]), cardIndex(k[1])] as const) : ([pool.pop()!, pool.pop()!] as const) };
    }),
    deck: [...rec.board.map(cardIndex), ...pool],
  };

  const thoughtOf = (a: ActionLogEntry): string | null =>
    rec.botReveals.find((r) => r.seat === a.seat)?.decisions.find((d) => d.actionIndex === a.i)?.thought ?? null;
  const frame = (state: HandState, street: Street, boardLen: number, action: ActionLogEntry | null): ReplayFrame => ({
    i: frames.length,
    street,
    board: state.board.slice(0, boardLen).map(cardString),
    seats: state.seats.map((p) => ({ seat: p.seat, stack: p.stack, bet: p.bet, folded: p.folded, allIn: p.allIn, cards: known.get(p.seat) ?? null })),
    pots: collectedPots(state),
    action,
    thought: action === null ? null : thoughtOf(action),
  });
  const frames: ReplayFrame[] = [];

  // Frame 0 and the two blind frames are rebuilt from the start stacks and the logged blind entries.
  const blinds = rec.actions.filter((a) => a.type === 'post_sb' || a.type === 'post_bb');
  if (blinds.length !== 2 || s.actions.length !== 2) fail('blinds');
  s.actions.forEach((a, i) => {
    const r = rec.actions[i]!;
    if (r.type !== a.type || r.seat !== a.seat || r.to !== a.to || r.added !== a.added) fail(`blind ${i}`);
  });
  const pre: HandState = { ...s, seats: s.seats.map((p) => ({ ...p, stack: p.stack + p.bet, bet: 0, committed: 0, allIn: false })) };
  frames.push(frame(pre, 'PREFLOP', 0, null));
  const afterSb: HandState = {
    ...pre,
    seats: pre.seats.map((p) => (p.seat === s.sbSeat ? { ...p, stack: p.stack - rec.actions[0]!.added, bet: rec.actions[0]!.added, committed: rec.actions[0]!.added } : p)),
  };
  frames.push(frame(afterSb, 'PREFLOP', 0, rec.actions[0]!));
  frames.push(frame(s, 'PREFLOP', 0, rec.actions[1]!));

  let shown = s.board.length;
  const dealFrames = (): void => {
    while (s.board.length > shown) {
      shown = shown === 0 ? 3 : shown + 1;
      frames.push(frame(s, STREET_OF_BOARD[shown]!, shown, null));
    }
  };
  const runout = (): void => {
    while (s.street === 'RUNOUT') {
      s = advanceRunout(s).state;
      dealFrames();
    }
  };

  for (const a of rec.actions.slice(2)) {
    runout();
    if (a.type === 'post_sb' || a.type === 'post_bb') fail(`unexpected blind at ${a.i}`);
    const forced = a.type === 'fold' && (a.auto === 'leave' || a.auto === 'kick') && s.toAct !== a.seat;
    if (forced) {
      s = forceFold(s, a.seat, a.auto!).state;
    } else {
      const needsTo = a.type === 'bet' || a.type === 'raise' || a.type === 'allin';
      const action: EngineAction = needsTo ? { seat: a.seat, type: a.type as EngineAction['type'], to: a.to } : { seat: a.seat, type: a.type as EngineAction['type'] };
      s = applyActionWith(s, action, a.auto).state;
    }
    const got = s.actions[a.i];
    if (got === undefined || got.type !== a.type || got.seat !== a.seat || got.to !== a.to || got.added !== a.added) fail(`action ${a.i}`);
    frames.push(frame(s, a.street, BOARD_AT[a.street] ?? 0, a));
    dealFrames();
  }
  runout();
  if (s.street !== 'COMPLETE' || s.result === null) fail('hand did not complete');
  frames.push(frame(s, 'COMPLETE', s.board.length, null));
  return { frames, final: s };
}

export function replayFrames(rec: HandRecordV1): ReplayFrame[] {
  return simulate(rec).frames;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** {ok: true} when re-running the record reproduces its board, pots, returns, showdown and end stacks. */
export function verifyReplay(rec: HandRecordV1): { ok: boolean; mismatch?: string } {
  try {
    const { final } = simulate(rec);
    const r = final.result!;
    if (!same(final.board.map(cardString), rec.board)) return { ok: false, mismatch: 'board' };
    if (!same(r.pots, rec.pots)) return { ok: false, mismatch: 'pots' };
    if (!same(final.returned, rec.returned)) return { ok: false, mismatch: 'returned' };
    const showdown = r.showdown.map((x) => ({ seat: x.seat, rank: rankLabel(x.rank) }));
    if (!same(showdown, rec.showdown.map((x) => ({ seat: x.seat, rank: x.rank })))) return { ok: false, mismatch: 'showdown' };
    if (!same(r.endStacks, rec.endStacks)) return { ok: false, mismatch: 'endStacks' };
    return { ok: true };
  } catch (e) {
    if (e instanceof Mismatch) return { ok: false, mismatch: e.message };
    // An engine rejection means the logged actions are not a legal hand.
    return { ok: false, mismatch: e instanceof Error ? `illegal: ${e.message}` : 'illegal' };
  }
}

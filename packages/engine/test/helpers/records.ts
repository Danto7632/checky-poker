// Test helper: real practice hand records (reducer + projection + RecordBuilder), each with the set of cards the
// recording seat actually saw. storage tests use it to check must_not_contain on IndexedDB rows (AC-11) without
// importing the table or projection subpaths themselves (storage may import only engine record/util).
import { legalActions } from '../../src/hand/legal';
import { projectView } from '../../src/projection/project';
import { createRecordBuilder } from '../../src/record/builder';
import type { HandRecordV1 } from '../../src/record/types';
import { randomInt, createSeededRng } from '../../src/util/rng';
import { practice } from './table';

export function practiceRecords(count: number, seed = 'records'): { rec: HandRecordV1; seen: Set<string> }[] {
  const h = practice(5, {}, seed);
  const style = createSeededRng(`${seed}-style`);
  const builder = createRecordBuilder({ mode: 'practice', appVersion: 'test-sha' });
  const seen = new Map<string, Set<string>>();
  const out: { rec: HandRecordV1; seen: Set<string> }[] = [];
  h.cmd({ t: 'START' });
  for (let guard = 0; guard < 50_000 && out.length < count; guard += 1) {
    const v = projectView(h.table, { kind: 'seat', seat: 0 });
    if (v.hand) {
      const set = seen.get(v.hand.handId) ?? new Set<string>();
      for (const c of [...(v.me.holeCards ?? []), ...v.hand.board, ...(v.result?.showdown.flatMap((x) => x.cards) ?? [])]) set.add(c);
      seen.set(v.hand.handId, set);
    }
    const rec = builder.onView(v);
    if (rec) out.push({ rec, seen: seen.get(rec.id)! });
    const hand = h.table.hand;
    if (h.table.phase === 'IN_HAND' && hand?.toAct === 0) {
      const l = legalActions(hand, 0)!;
      h.act(randomInt(style, 4) === 0 ? 'fold' : l.check ? 'check' : 'call');
    } else if (h.table.phase === 'PAUSED') {
      h.resume();
    } else {
      const next = [...h.timers.values()].sort((a, b) => a - b)[0];
      if (next === undefined) break;
      h.advance(next - h.now);
    }
  }
  return out;
}

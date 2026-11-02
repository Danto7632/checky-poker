// AC-11: self-view records and replay. ① 200 practice hands (1 human + 5 rule bots) through the real reducer,
// recorded from my view; ② 200 hands of a 3-human + 3-bot table driven with engine functions (friend seating is
// 2-1), recorded from EVERY human seat. Checks: one record per COMPLETE hand, null for VOIDED, `no`, playedAt '',
// RankCode, must_not_contain (other humans' unshown cards, deck/future board, human chat, rpk, room code),
// verifyReplay 100 %, last replay frame stacks = endStacks, rankCode/rankDetail, record API takes no state.
import { describe, expect, it } from 'vitest';
import { cardString } from '../../src/cards/card';
import { applyAction } from '../../src/hand/apply';
import { createHand } from '../../src/hand/create';
import { legalActions } from '../../src/hand/legal';
import { advanceRunout } from '../../src/hand/runout';
import type { HandState } from '../../src/hand/state';
import { projectView } from '../../src/projection/project';
import * as recordApi from '../../src/record';
import { createRecordBuilder, rankCode, rankDetail, replayFrames, verifyReplay } from '../../src/record';
import type { HandRecordV1 } from '../../src/record';
import type { ChatLine, EngineAction } from '../../src/protocol/view-types';
import { createTable } from '../../src/table/reduce';
import type { TableState } from '../../src/table/state';
import { createSeededRng, randomInt, type Rng } from '../../src/util/rng';
import { collectCardLeaks } from '../helpers/card-leak';
import { HOST, practice, ruleBot, tableConfig } from '../helpers/table';

const ROOM_CODE = 'K7M2Q9XRT4';
const HUMAN_CHAT = 'my secret plan is to bluff';
const RPKS = ['rpkHostDeviceKey000000', 'rpkKenjiDeviceKey00000', 'rpkSoraDeviceKey000000'];

function checkRecord(rec: HandRecordV1, mustNot: { cards: Set<string>; strings: string[] }): void {
  expect(rec.playedAt).toBe('');
  expect(rec.appVersion).toBe('test-sha');
  for (const s of rec.showdown) expect(['high_card', 'pair', 'two_pair', 'trips', 'straight', 'flush', 'full_house', 'quads', 'straight_flush']).toContain(s.rank);
  const allowed = new Set([...Array(52).keys()].map(cardString).filter((c) => !mustNot.cards.has(c)));
  expect(collectCardLeaks(rec, allowed)).toEqual([]);
  const text = JSON.stringify(rec);
  for (const x of mustNot.strings) expect(text).not.toContain(x);
  const v = verifyReplay(rec);
  expect(v).toEqual({ ok: true });
  const frames = replayFrames(rec);
  const last = frames.at(-1)!;
  expect(last.seats.map((s) => ({ seat: s.seat, stack: s.stack }))).toEqual(rec.endStacks);
  expect(frames[0]!.action).toBeNull();
}

describe('① practice: 200 hands recorded from my view', () => {
  it('one record per completed hand, all checks pass', () => {
    const h = practice(5, {}, 'record-practice');
    const builder = createRecordBuilder({ mode: 'practice', appVersion: 'test-sha' });
    const records: HandRecordV1[] = [];
    const style = createSeededRng('my-style');
    h.cmd({ t: 'START' });
    let lastNo = 0;
    for (let guard = 0; guard < 20000 && records.length < 200; guard += 1) {
      const view = projectView(h.table, { kind: 'seat', seat: 0 });
      const rec = builder.onView(view);
      if (rec) {
        // must_not_contain for a practice hand: every card I did not see (deck, future board).
        const seen = new Set<string>([...(view.me.holeCards ?? []), ...view.hand!.board, ...view.result!.showdown.flatMap((x) => x.cards)]);
        checkRecord(rec, { cards: new Set([...Array(52).keys()].map(cardString).filter((c) => !seen.has(c))), strings: [HOST.rpk] });
        expect(rec.no).toBe(view.hand!.no);
        expect(rec.no).toBeGreaterThan(lastNo);
        lastNo = rec.no!;
        expect(builder.onView(view)).toBeNull(); // the same hand never twice
        records.push(rec);
      }
      const hand = h.table.hand;
      if (h.table.phase === 'IN_HAND' && hand?.toAct === 0) {
        const l = legalActions(hand, 0)!;
        // Mix in folds so my seat is not always at showdown.
        h.act(randomInt(style, 3) === 0 ? 'fold' : l.check ? 'check' : 'call');
      } else if (h.table.phase === 'PAUSED') {
        h.resume(); // refills a busted seat first (practice rule R-7)
      } else {
        const next = [...h.timers.values()].sort((a, b) => a - b)[0]!;
        h.advance(next - h.now);
      }
    }
    expect(records).toHaveLength(200);
    expect(records.some((r) => r.showdown.length > 0)).toBe(true);
    expect(records.some((r) => r.actions.some((a) => a.seat === 0 && a.type === 'fold'))).toBe(true);
  });

  it('a VOIDED hand gives null and never a record', () => {
    const h = practice(5);
    const b = createRecordBuilder({ mode: 'practice', appVersion: 'test-sha' });
    h.cmd({ t: 'START' });
    expect(b.onView(projectView(h.table, { kind: 'seat', seat: 0 }))).toBeNull();
    h.cmd({ t: 'CLOSE', mode: 'now' });
    expect(h.table.hand!.street).toBe('VOIDED');
    expect(b.onView(projectView(h.table, { kind: 'seat', seat: 0 }))).toBeNull();
  });
});

// ---- ② a 3-human + 3-bot table driven directly with engine functions ------------------------------------------
function sixSeatTable(): TableState {
  const base = createTable(tableConfig('friend'), HOST);
  const seat = (i: number, kind: 'human' | 'bot', nick: string) => ({
    seat: i, kind, rpk: kind === 'human' ? RPKS[i]! : null, nick, avatarSeed: i, isHost: i === 0, status: 'ACTIVE' as const,
    stack: 3000, strikes: 0, sitOutReason: null, connected: true, bot: kind === 'bot' ? ruleBot(nick) : null,
  });
  return {
    ...base,
    phase: 'IN_HAND',
    seats: [seat(0, 'human', 'Mina'), seat(1, 'human', 'Kenji'), seat(2, 'human', 'Sora'), seat(3, 'bot', 'Ada'), seat(4, 'bot', 'Rex'), seat(5, 'bot', 'Lena')],
  };
}

function randomAction(s: HandState, rng: Rng): EngineAction {
  const seat = s.toAct!;
  const l = legalActions(s, seat)!;
  const r = randomInt(rng, 100);
  if (r < 18) return { seat, type: 'fold' };
  if (l.check && r < 70) return { seat, type: 'check' };
  if (l.call && r < 75) return { seat, type: 'call' };
  if (l.raise && r < 85) return { seat, type: 'raise', to: l.raise.minTo + randomInt(rng, Math.min(400, l.raise.maxTo - l.raise.minTo) + 1) };
  if (l.bet && r < 85) return { seat, type: 'bet', to: l.bet.min + randomInt(rng, Math.min(400, l.bet.max - l.bet.min) + 1) };
  if (r < 88) return { seat, type: 'allin', to: l.allIn.to }; // always accepted (advertised => accepted, R0 M2)
  return l.check ? { seat, type: 'check' } : { seat, type: 'call' };
}

describe('② 3 humans + 3 bots: 200 hands recorded from every human seat', () => {
  it('records from each human view hold nothing that seat did not see', () => {
    const rng = createSeededRng('record-6');
    let table = sixSeatTable();
    const builders = [0, 1, 2].map(() => createRecordBuilder({ mode: 'friend', appVersion: 'test-sha' }));
    let made = 0;
    let withFoldedHuman = 0;
    for (let n = 1; n <= 200; n += 1) {
      for (const s of table.seats) if (s && s.stack === 0) s.stack = 3000; // refill between hands
      const dealt = table.seats.filter((s) => s !== null && s.stack > 0).map((s) => ({ seat: s!.seat, stack: s!.stack }));
      // Blinds come from the room settings, as the reducer does (the record copies room.settings.sb/bb).
      const { sb, bb } = table.config.settings;
      let hand = createHand({ handId: `hand${String(n).padStart(18, '0')}`, seats: dealt, buttonSeat: dealt[n % dealt.length]!.seat, sb, bb }, rng);
      table = { ...table, phase: 'IN_HAND', hand, handNo: n };
      const chat = (line: Omit<ChatLine, 'id' | 'atMs' | 'handId'>) => {
        const full: ChatLine = { id: `c${n}`, atMs: 0, handId: hand.handId, ...line };
        builders.forEach((b) => b.onChat(full));
      };
      const step = () => {
        table = { ...table, hand };
        for (const seat of [0, 1, 2]) builders[seat]!.onView(projectView(table, { kind: 'seat', seat }));
      };
      step();
      chat({ seat: 1, name: 'Kenji', kind: 'human', text: HUMAN_CHAT, sys: null });
      chat({ seat: null, name: 'Sora', kind: 'system', text: `Sora joined ${ROOM_CODE}`, sys: { code: 'joined', name: 'Sora' } });
      for (let guard = 0; guard < 300 && hand.street !== 'COMPLETE'; guard += 1) {
        hand = hand.street === 'RUNOUT' ? advanceRunout(hand).state : applyAction(hand, randomAction(hand, rng)).state;
        if (guard === 2) chat({ seat: 4, name: 'Rex', kind: 'bot', text: 'Raising here, brave or not.', sys: null });
        step();
      }
      expect(hand.street).toBe('COMPLETE');
      for (const e of hand.result!.endStacks) table.seats[e.seat]!.stack = e.stack;
      table = { ...table, phase: 'BETWEEN_HANDS', hand, handsPlayed: n };
      const showdownSeats = new Set(hand.result!.showdown.map((x) => x.seat));
      if (hand.seats.some((p) => p.seat < 3 && p.folded)) withFoldedHuman += 1;
      for (const seat of [0, 1, 2]) {
        const view = projectView(table, { kind: 'seat', seat });
        const rec = builders[seat]!.onView(view);
        expect(rec).not.toBeNull();
        made += 1;
        // must_not_contain: other humans' cards not shown, the deck and any card not dealt to the board.
        const hidden = new Set<string>(hand.deck.map(cardString));
        for (const p of hand.seats) if (p.seat < 3 && p.seat !== seat && !showdownSeats.has(p.seat)) for (const c of p.hole) hidden.add(cardString(c));
        checkRecord(rec!, { cards: hidden, strings: [HUMAN_CHAT, ROOM_CODE, ...RPKS] });
        expect(rec!.botChat.map((x) => x.text)).toContain('Raising here, brave or not.');
        expect(rec!.me.seat).toBe(hand.seats.some((p) => p.seat === seat) ? seat : null);
      }
    }
    expect(made).toBe(600);
    expect(withFoldedHuman).toBeGreaterThan(50);
  });
});

describe('verifyReplay catches tampering', () => {
  it('changed end stacks, pots or a showdown card are reported', () => {
    const h = practice(5, {}, 'tamper');
    const b = createRecordBuilder({ mode: 'practice', appVersion: 'test-sha' });
    h.cmd({ t: 'START' });
    // Play until a hand with a 2+ player showdown is recorded.
    let rec: HandRecordV1 | null = null;
    for (let guard = 0; guard < 5000 && rec === null; guard += 1) {
      const got = b.onView(projectView(h.table, { kind: 'seat', seat: 0 }));
      if (got !== null && got.showdown.length >= 2) rec = got;
      if (h.table.phase === 'IN_HAND' && h.table.hand?.toAct === 0) {
        const l = legalActions(h.table.hand, 0)!;
        h.act(l.check ? 'check' : 'call');
      } else if (h.table.phase === 'PAUSED') h.resume();
      else h.advance([...h.timers.values()].sort((a, b2) => a - b2)[0]! - h.now);
    }
    expect(rec).not.toBeNull();
    expect(verifyReplay(rec!)).toEqual({ ok: true });
    const r = rec!;
    expect(verifyReplay({ ...r, endStacks: r.endStacks.map((e, i) => (i === 0 ? { ...e, stack: e.stack + 1 } : e)) })).toMatchObject({ ok: false, mismatch: 'endStacks' });
    expect(verifyReplay({ ...r, pots: r.pots.map((p) => ({ ...p, amount: p.amount + 1 })) })).toMatchObject({ ok: false });
    expect(verifyReplay({ ...r, actions: r.actions.slice(0, -1) })).toMatchObject({ ok: false });
  });
});

describe('rankCode / rankDetail (A-REC-RANK)', () => {
  it('fewer than 5 cards -> null; 9 categories; rankDetail.code === rankCode; ranks per the contract', () => {
    expect(rankCode(['As', 'Kd'])).toBeNull();
    expect(rankDetail(['As', 'Kd', 'Qh', 'Jc'])).toBeNull();
    const cases: [string[], string, string[]][] = [
      [['As', 'Kd', '9h', '7c', '2s'], 'high_card', ['A']],
      [['As', 'Ad', '9h', '7c', '2s'], 'pair', ['A']],
      [['As', 'Ad', '9h', '9c', '2s', 'Ks'], 'two_pair', ['A', '9']],
      [['7s', '7d', '7h', 'Ac', '2s'], 'trips', ['7']],
      [['Ah', '2c', '3d', '4s', '5h'], 'straight', ['5']],
      [['Ah', '9h', '7h', '4h', '2h', 'Kd'], 'flush', ['A']],
      [['7s', '7d', '7h', 'Ac', 'As'], 'full_house', ['7', 'A']],
      [['7s', '7d', '7h', '7c', 'As'], 'quads', ['7']],
      [['Ts', 'Js', 'Qs', 'Ks', 'As', '2d', '3c'], 'straight_flush', ['A']],
    ];
    for (const [cards, code, ranks] of cases) {
      expect(rankCode(cards as never)).toBe(code);
      expect(rankDetail(cards as never)).toEqual({ code, ranks });
      expect(rankDetail(cards as never)?.code).toBe(rankCode(cards as never));
    }
  });
});

describe('record API surface takes no TableState or HandState', () => {
  it('exports only view/record-based functions', () => {
    expect(Object.keys(recordApi).filter((k) => typeof (recordApi as Record<string, unknown>)[k] === 'function').sort()).toEqual(
      ['createRecordBuilder', 'rankCode', 'rankDetail', 'replayFrames', 'summarizeRecord', 'upgradeRecord', 'verifyReplay'].sort(),
    );
    type Takes<F> = F extends (a: infer A, ...rest: never[]) => unknown ? A : never;
    type NotState<A> = [A] extends [HandState | TableState] ? false : true;
    const checks: [
      NotState<Takes<typeof recordApi.createRecordBuilder>>,
      NotState<Takes<typeof recordApi.replayFrames>>,
      NotState<Takes<typeof recordApi.verifyReplay>>,
      NotState<Takes<typeof recordApi.rankCode>>,
      NotState<Takes<typeof recordApi.summarizeRecord>>,
    ] = [true, true, true, true, true];
    expect(checks.every(Boolean)).toBe(true);
  });
});

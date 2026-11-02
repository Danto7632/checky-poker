// AC-9 (MS-R0-4): the api-contracts section 4 projection table as a table-driven test — row x viewer x street.
// Fixture: a friend room built directly (seating is 2-1): seat 0 host Mina, 1 Kenji, 2 Sora (humans), 3..5 bots,
// plus a waiting viewer. Test names read "<row> | <viewer> | <street>".
import { describe, expect, it } from 'vitest';
import { cardString } from '../../src/cards/card';
import { advanceRunout } from '../../src/hand/runout';
import type { HandState } from '../../src/hand/state';
import { projectView } from '../../src/projection/project';
import { verifyView } from '../../src/projection/verify';
import { brandView } from '../../src/projection/brand';
import { createTable } from '../../src/table/reduce';
import type { TableState, Viewer } from '../../src/table/state';
import { CheckyError } from '../../src/util/checky-error';
import { collectCardLeaks } from '../helpers/card-leak';
import { ASSERT_BENCH, testLog } from '../helpers/log';
import { act, newHand, rig } from '../helpers/hand';
import { HOST, practice, ruleBot, tableConfig } from '../helpers/table';

const RPK = { 0: 'rpkHostDeviceKey000000', 1: 'rpkKenjiDeviceKey00000', 2: 'rpkSoraDeviceKey000000' } as const;

function friendTable(hand: HandState, phase: TableState['phase'] = 'IN_HAND'): TableState {
  const base = createTable(tableConfig('friend'), HOST);
  const human = (seat: 1 | 2, nick: string) => ({
    seat, kind: 'human' as const, rpk: RPK[seat], nick, avatarSeed: seat, isHost: false, status: 'ACTIVE' as const,
    stack: 10000, strikes: 0, sitOutReason: null, connected: true, bot: null,
  });
  const bot = (seat: number, label: string) => ({
    seat, kind: 'bot' as const, rpk: null, nick: label, avatarSeed: seat, isHost: false, status: 'ACTIVE' as const,
    stack: 10000, strikes: 0, sitOutReason: null, connected: true, bot: ruleBot(label),
  });
  const seats = [base.seats[0]!, human(1, 'Kenji'), human(2, 'Sora'), bot(3, 'Ada'), bot(4, 'Rex'), bot(5, 'Lena')];
  return { ...base, phase, seats, hand, handNo: 4, handsPlayed: phase === 'BETWEEN_HANDS' ? 4 : 3, buttonSeat: 0 };
}

const HOLE = { 0: ['As', 'Ad'], 1: ['Ks', 'Kd'], 2: ['Qs', 'Qd'], 3: ['Js', 'Jd'], 4: ['Ts', 'Td'], 5: ['9s', '9d'] } as const;
const BOARD = ['2c', '7h', '8c', '3d', '4h'] as const;

/** Main line: Sora (human, seat 2) folds preflop, Rex (bot, seat 4) folds preflop; the rest check/call down. */
function streets(): Record<'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'COMPLETE' | 'RUNOUT', HandState> {
  let s = rig(newHand({ 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 10000, 5: 10000 }, 0, [50, 100], 'proj'), HOLE as never, [...BOARD]);
  const out = { PREFLOP: s } as Record<'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN' | 'COMPLETE' | 'RUNOUT', HandState>;
  s = act(s, 3, 'call');
  s = act(s, 4, 'fold');
  s = act(s, 5, 'call');
  s = act(s, 0, 'call');
  s = act(s, 1, 'call');
  s = act(s, 2, 'fold');
  out.FLOP = s;
  for (const street of ['TURN', 'RIVER'] as const) {
    for (const seat of [1, 3, 5, 0]) s = act(s, seat, 'check');
    out[street] = s;
  }
  out.SHOWDOWN = { ...s, street: 'SHOWDOWN', toAct: null };
  for (const seat of [1, 3, 5, 0]) s = act(s, seat, 'check');
  out.COMPLETE = s;
  // All-in runout: UTG bot shoves, host and Kenji call all-in, the others fold — 1 board street dealt.
  let r = rig(newHand({ 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 10000, 5: 10000 }, 0, [50, 100], 'proj-r'), HOLE as never, [...BOARD]);
  r = act(r, 3, 'allin', 10000);
  r = act(r, 4, 'fold');
  r = act(r, 5, 'fold');
  r = act(r, 0, 'allin', 10000);
  r = act(r, 1, 'allin', 10000);
  r = act(r, 2, 'fold');
  expect(r.street).toBe('RUNOUT');
  out.RUNOUT = advanceRunout(r).state;
  return out;
}

const VIEWERS: Record<string, Viewer> = {
  host: { kind: 'seat', seat: 0 },
  guest: { kind: 'seat', seat: 1 },
  foldedGuest: { kind: 'seat', seat: 2 },
  waiting: { kind: 'waiting', conn: 'c9' },
  bot: { kind: 'bot', seat: 3 },
};
const ownSeat = (v: Viewer) => (v.kind === 'seat' || v.kind === 'bot' ? v.seat : null);
const cardsOf = (seat: number) => [...HOLE[seat as keyof typeof HOLE]];

describe('AC-9 projection table (row x viewer x street)', () => {
  const S = streets();
  for (const [street, hand] of Object.entries(S)) {
    const table = friendTable(hand, street === 'COMPLETE' ? 'BETWEEN_HANDS' : 'IN_HAND');
    const live = new Set(hand.seats.filter((p) => !p.folded).map((p) => p.seat));
    const shown = street === 'SHOWDOWN' || street === 'COMPLETE';
    for (const [vname, viewer] of Object.entries(VIEWERS)) {
      const v = projectView(table, viewer);
      const me = ownSeat(viewer);
      const prefix = `| ${vname} | ${street}`;

      it(`public table (room, occupants, hand) present ${prefix}`, () => {
        expect(v.room.kind).toBe('friend');
        expect(v.seats).toHaveLength(6);
        expect(v.seats.every((s) => s.occupant !== null)).toBe(true);
        expect(v.hand?.handId).toBe(hand.handId);
        expect(v.hand?.board).toEqual(hand.board.map(cardString));
        expect(() => verifyView(v, table, viewer)).not.toThrow();
      });

      it(`deck and future board appear nowhere ${prefix}`, () => {
        const deck = new Set(hand.deck.map(cardString));
        const leaks = collectCardLeaks(v, new Set([...Array(52).keys()].map(cardString).filter((c) => !deck.has(c))));
        expect(leaks).toEqual([]);
      });

      it(`own hole cards only in me.holeCards ${prefix}`, () => {
        if (me === null) expect(v.me.holeCards).toBeNull();
        else expect(v.me.holeCards).toEqual(cardsOf(me));
        if (me !== null && !shown) expect(v.seats[me]!.occupant!.inHand?.cards ?? null).toBeNull();
      });

      it(`other humans' cards: revealed from SHOWDOWN on (never during RUNOUT), folded humans never ${prefix}`, () => {
        for (const seat of [0, 1, 2]) {
          if (seat === me) continue;
          const cards = v.seats[seat]!.occupant!.inHand?.cards ?? null;
          if (shown && live.has(seat)) expect(cards).toEqual(cardsOf(seat));
          else expect(cards).toBeNull();
          if (!live.has(seat) || !shown) {
            const allowed = new Set([...Array(52).keys()].map(cardString).filter((c) => !cardsOf(seat).includes(c as never)));
            expect(collectCardLeaks(v, allowed)).toEqual([]);
          }
        }
      });

      it(`bot cards: hidden from others during the hand, all shown at COMPLETE (D16) ${prefix}`, () => {
        for (const seat of [3, 4, 5]) {
          if (seat === me) continue;
          const cards = v.seats[seat]!.occupant!.inHand?.cards ?? null;
          const expected = street === 'COMPLETE' || (street === 'SHOWDOWN' && live.has(seat)) ? cardsOf(seat) : null;
          expect(cards).toEqual(expected);
        }
        expect(v.arena).toBeNull();
        expect(v.result?.botReveals ?? []).toEqual([]);
      });

      it(`no equity, no player id (rpk), no key anywhere ${prefix}`, () => {
        const text = JSON.stringify(v);
        for (const rpk of Object.values(RPK)) expect(text).not.toContain(rpk);
        expect(text).not.toMatch(/equity|apiKey|sk-/);
      });
    }

    it(`bot view = that bot's seat view (deep equal) | ${street}`, () => {
      expect(projectView(table, { kind: 'bot', seat: 3 })).toEqual(projectView(table, { kind: 'seat', seat: 3 }));
    });
  }

  it('result only between hands; hand kept; countdown and turn clocks are remaining ms', () => {
    const S2 = streets();
    const t = { ...friendTable(S2.COMPLETE, 'BETWEEN_HANDS'), nowMs: 1000, countdownDeadline: 6000 };
    const v = projectView(t, VIEWERS.guest!);
    expect(v.result?.showdown.map((x) => x.seat)).toEqual([1, 3, 5, 0]);
    expect(v.result?.showdown[0]).toMatchObject({ cards: ['Ks', 'Kd'], rank: expect.any(String) });
    expect(v.room.countdownMs).toBe(5000);
    const inHand = { ...friendTable(S2.FLOP), nowMs: 2000, turnDeadline: 26000 };
    expect(projectView(inHand, VIEWERS.guest!).hand!.turnMs).toBe(24000);
    expect(projectView(inHand, VIEWERS.guest!).result).toBeNull();
  });
});

// R0 M3 (review repro b.tt): a hand voided after the flop (close now, E-ENG-INVARIANT) still carries its dealt
// board, and verifyView used to allow no card at all for VOIDED -> a false E-PROJ-LEAK-BLOCKED on the last view.
describe('VOIDED hand (board 0 / 3 / 5) x every viewer: the dealt board is public, no hole card anywhere', () => {
  const S = streets();
  for (const [street, hand] of [['PREFLOP', S.PREFLOP], ['FLOP', S.FLOP], ['RIVER', S.RIVER]] as const) {
    for (const phase of ['CLOSED', 'PAUSED'] as const) {
      const table = friendTable({ ...hand, street: 'VOIDED', toAct: null }, phase);
      for (const [vname, viewer] of Object.entries(VIEWERS)) {
        it(`voided at ${street} (board ${hand.board.length}) | ${vname} | ${phase}`, () => {
          const v = projectView(table, viewer);
          expect(() => verifyView(v, table, viewer)).not.toThrow();
          expect(v.hand).toMatchObject({ street: 'VOIDED', board: hand.board.map(cardString), pots: [] });
          expect(v.me.holeCards).toBeNull();
          expect(v.me.legal).toBeNull();
          expect(v.result).toBeNull();
          expect(collectCardLeaks(v, new Set(hand.board.map(cardString)))).toEqual([]);
        });
      }
    }
  }

  it('real path: practice, flop dealt, CLOSE now -> the CLOSED view passes verifyView', () => {
    const h = practice(5, {}, 'voidflop');
    h.cmd({ t: 'START' });
    h.playUntil((t) => (t.hand?.board.length ?? 0) >= 3);
    expect(h.table.hand!.board.length).toBeGreaterThanOrEqual(3);
    h.cmd({ t: 'CLOSE', mode: 'now' });
    expect(h.table).toMatchObject({ phase: 'CLOSED', hand: { street: 'VOIDED' } });
    const v = projectView(h.table, VIEWERS.host!);
    expect(() => verifyView(v, h.table, VIEWERS.host!)).not.toThrow();
    expect(v.hand!.board).toEqual(h.table.hand!.board.map(cardString));
  });

  it('a voided view that carries a hole card is still blocked', () => {
    const table = friendTable({ ...S.FLOP, street: 'VOIDED', toAct: null }, 'CLOSED');
    const v = projectView(table, VIEWERS.host!);
    const leaked = brandView({ ...v, me: { ...v.me, holeCards: cardsOf(0) as never } });
    expect(() => verifyView(leaked, table, VIEWERS.host!)).toThrow(CheckyError);
  });
});

// R0-L1: after a hand that is not followed by another one (PAUSED at hand end, CLOSED after "close after this
// hand"), hand and result stay in every room kind; the next hand clears result.
describe('R0-L1 hand and result stay after the last hand (every room kind)', () => {
  const S = streets();
  for (const phase of ['PAUSED', 'CLOSED'] as const) {
    for (const [vname, viewer] of Object.entries(VIEWERS)) {
      it(`friend | ${phase} | ${vname}: result and the COMPLETE hand are in the view`, () => {
        const table = friendTable(S.COMPLETE, phase);
        const v = projectView(table, viewer);
        expect(v.hand?.street).toBe('COMPLETE');
        expect(v.result?.handId).toBe(S.COMPLETE.handId);
        expect(() => verifyView(v, table, viewer)).not.toThrow();
      });
    }
  }
  it('practice | CLOSED after "close after this hand": the last hand result reaches the view; a new hand clears it', () => {
    const h = practice(5, {}, 'l1');
    h.cmd({ t: 'START' });
    h.cmd({ t: 'CLOSE', mode: 'after_hand' });
    h.playUntil((t) => t.phase === 'CLOSED');
    expect(projectView(h.table, VIEWERS.host!).result?.handId).toBe(h.table.hand!.handId);
    const next = practice(5, {}, 'l1');
    next.cmd({ t: 'START' });
    next.playUntil((t) => t.phase === 'BETWEEN_HANDS');
    expect(projectView(next.table, VIEWERS.host!).result).not.toBeNull();
    next.advance(5000);
    expect(next.table.phase).toBe('IN_HAND');
    expect(projectView(next.table, VIEWERS.host!).result).toBeNull();
  });
});

describe('arena projection (SS7-AC2 / SS30-AC1 — kept even if US47 is cut)', () => {
  it('a room with a human: {kind:"arena"} is E-PROJ-ARENA-DENIED and returns nothing', () => {
    const t = friendTable(streets().FLOP);
    let out: unknown = 'untouched';
    try {
      out = projectView(t, { kind: 'arena' });
    } catch (e) {
      expect(e).toBeInstanceOf(CheckyError);
      expect((e as CheckyError).code).toBe('E-PROJ-ARENA-DENIED');
    }
    expect(out).toBe('untouched');
    const p = practice(5);
    p.cmd({ t: 'START' });
    expect(() => projectView(p.table, { kind: 'arena' })).toThrow(CheckyError);
  });

  it('kind arena + transport none + bots only: allowed, every bot hand visible to the spectator', () => {
    const base = createTable(tableConfig('arena', { seatCount: 2, turnSeconds: null }), null);
    const hand = newHand({ 0: 10000, 1: 10000 }, 0);
    const bot = (seat: number) => ({ seat, kind: 'bot' as const, rpk: null, nick: `B${seat}`, avatarSeed: seat, isHost: false, status: 'ACTIVE' as const, stack: 10000, strikes: 0, sitOutReason: null, connected: true, bot: ruleBot(`B${seat}`) });
    const t: TableState = { ...base, phase: 'IN_HAND', seats: [bot(0), bot(1)], hand, handNo: 1 };
    const v = projectView(t, { kind: 'arena' });
    expect(v.me.role).toBe('spectator');
    expect(v.arena?.bots.map((b) => b.holeCards)).toEqual(hand.seats.map((p) => p.hole.map(cardString)));
    expect(() => verifyView(v, t, { kind: 'arena' })).not.toThrow();
  });
});

describe('verifyView (line of defence 2)', () => {
  const t = friendTable(streets().FLOP);
  it('a view carrying another human\'s hole cards is E-PROJ-LEAK-BLOCKED', () => {
    const v = projectView(t, VIEWERS.guest!);
    const leaky = brandView({ ...v, seats: v.seats.map((s) => (s.seat === 0 && s.occupant?.inHand ? { ...s, occupant: { ...s.occupant, inHand: { ...s.occupant.inHand, cards: ['As', 'Ad'] } } } : s)) });
    expect(() => verifyView(leaky, t, VIEWERS.guest!)).toThrow(expect.objectContaining({ code: 'E-PROJ-LEAK-BLOCKED' }));
    const futureBoard = brandView({ ...v, hand: { ...v.hand!, board: [...v.hand!.board, '3d'] } });
    expect(() => verifyView(futureBoard, t, VIEWERS.guest!)).toThrow(expect.objectContaining({ code: 'E-PROJ-LEAK-BLOCKED' }));
    const wrongMe = brandView({ ...v, me: { ...v.me, holeCards: ['Qs', 'Qd'] } });
    expect(() => verifyView(wrongMe, t, VIEWERS.guest!)).toThrow(expect.objectContaining({ code: 'E-PROJ-LEAK-BLOCKED' }));
  });

  it('a nickname that looks like a card ("Kd") is not a false positive (card fields only)', () => {
    const named = { ...t, seats: t.seats.map((s) => (s && s.seat === 4 ? { ...s, nick: 'Kd' } : s)) };
    const v = projectView(named, VIEWERS.guest!);
    expect(v.seats[4]!.occupant!.name).toBe('Kd');
    expect(() => verifyView(v, named, VIEWERS.guest!)).not.toThrow();
  });

  it('runs well under the 0.1 ms target per view (6 seats)', () => {
    const v = projectView(t, VIEWERS.host!);
    const n = 20000;
    const start = Date.now();
    for (let i = 0; i < n; i += 1) verifyView(v, t, VIEWERS.host!);
    const perView = (Date.now() - start) / n;
    testLog(`[bench] verifyView ${perView.toFixed(4)} ms/view (assert ${ASSERT_BENCH ? 'on' : 'off'})`);
    if (ASSERT_BENCH) expect(perView).toBeLessThan(0.1);
  });
});

describe('practice fixture (1 human + 5 bots): every view of 6 seats has no rpk', () => {
  it('rpk never appears in any viewer projection through 30 hands', () => {
    const p = practice(5);
    p.cmd({ t: 'START' });
    for (let k = 0; k < 30; k += 1) {
      p.playUntil((tt) => tt.phase !== 'IN_HAND');
      for (const viewer of [VIEWERS.host!, { kind: 'bot', seat: 2 } as Viewer]) {
        expect(JSON.stringify(projectView(p.table, viewer))).not.toContain(HOST.rpk);
      }
      if (p.table.phase === 'BETWEEN_HANDS') p.advance(5000);
      else if (p.table.phase === 'PAUSED') p.resume();
    }
  });
});

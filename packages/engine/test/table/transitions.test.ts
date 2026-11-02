// AC-6 / AC-7 / AC-8: the practice room state machine (E-3 with 1.0.4-p1 F-JN-05 + W5-U2), turn timers and
// timeouts, refills and busted seats. Driven through reduceTable only, with a fake clock and seeded rng.
import { describe, expect, it } from 'vitest';
import { legalActions } from '../../src/hand/legal';
import type { HostCommand } from '../../src/protocol/messages';
import { projectView } from '../../src/projection/project';
import { createTable } from '../../src/table/reduce';
import type { TableState } from '../../src/table/state';
import { CheckyError } from '../../src/util/checky-error';
import { createSeededRng, randomInt } from '../../src/util/rng';
import { rig } from '../helpers/hand';
import { HOST, Harness, practice, ruleBot, tableConfig } from '../helpers/table';

const view = (t: TableState) => projectView(t, { kind: 'seat', seat: 0 });
const setSeat = (h: Harness, seat: number, patch: Partial<NonNullable<TableState['seats'][number]>>) => {
  h.table = { ...h.table, seats: h.table.seats.map((s) => (s && s.seat === seat ? { ...s, ...patch } : s)) };
};
const handOver = (t: TableState) => t.phase !== 'IN_HAND' && t.phase !== 'CLOSING_AFTER_HAND';
const dealt = (t: TableState) => t.hand!.seats.map((p) => p.seat);

/**
 * Rig the running hand (before any voluntary action) so `winner` holds aces against seven-high hands, then shove
 * seat 0 on each of its turns while the passive auto-bots call, until the hand is over.
 */
function shoveDown(h: Harness, winner: 'me' | 'bots'): void {
  const hole = winner === 'me' ? { 0: ['As', 'Ah'], 1: ['7c', '2d'], 2: ['8d', '3c'] } : { 0: ['7c', '2d'], 1: ['As', 'Ah'], 2: ['Ks', 'Kh'] };
  h.table = { ...h.table, hand: rig(h.table.hand!, hole as never, ['Kd', 'Qh', '9s', '4c', '5h']) };
  for (let guard = 0; guard < 40 && !handOver(h.table); guard += 1) {
    const hand = h.table.hand!;
    if (hand.toAct === 0) h.act('allin', legalActions(hand, 0)!.allIn.to);
    else h.advance(1500);
  }
}

/** A friend room in WAITING: me (host, short at 1000, so both bots keep chips after calling my shove) + 2 rule bots. */
function friendWithTwoBots(seatCount: number, seed?: string): Harness {
  const h = new Harness(tableConfig('friend', { seatCount }), seed);
  h.table = { ...h.table, phase: 'WAITING' }; // friend OPENING -> WAITING is 2-1 (relay registration)
  h.cmd({ t: 'ADD_BOT', seat: null, bot: ruleBot('A') });
  h.cmd({ t: 'ADD_BOT', seat: null, bot: ruleBot('B') });
  setSeat(h, 0, { stack: 1000 });
  return h;
}

describe('AC-8 practice start, auto-advance, pause (E-3 + F-JN-05)', () => {
  it('practice tables start WAITING; START with < 2 chip seats is E-ROOM-START-MIN-PLAYERS and changes nothing', () => {
    const h = practice(0, { seatCount: 2 });
    expect(h.table.phase).toBe('WAITING');
    const before = h.table;
    const r = h.cmd({ t: 'START' }, 1);
    expect(r.table).toBe(before);
    expect(h.errors()).toEqual(['E-ROOM-START-MIN-PLAYERS']);
    expect(h.effects()).toContainEqual({ t: 'SEND', to: 'local', env: { v: 1, t: 'H.NACK', s: 0, b: { c: 1, code: 'E-ROOM-START-MIN-PLAYERS' } } });
  });

  it('START deals the first hand and ACKs; hand end -> BETWEEN_HANDS 5000 ms -> the next hand', () => {
    const h = practice(5);
    h.cmd({ t: 'START' }, 7);
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.effects()).toContainEqual({ t: 'SEND', to: 'local', env: { v: 1, t: 'H.ACK', s: 0, b: { c: 7 } } });
    h.playUntil(handOver);
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    expect(view(h.table).room.countdownMs).toBe(5000);
    expect(view(h.table).result).not.toBeNull();
    h.advance(4999);
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    h.advance(1);
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.table.handNo).toBe(2);
    expect(view(h.table).result).toBeNull();
  });

  it('PAUSE during a hand is pending: the hand plays out, then PAUSED + N-PAUSED with no countdown; hand/result stay', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.cmd({ t: 'PAUSE' });
    expect(h.table).toMatchObject({ phase: 'IN_HAND', paused: true });
    let notices: string[] = [];
    while (!handOver(h.table)) {
      h.playUntil((t) => handOver(t) || t.hand!.toAct !== 0, 0);
      const before = h.log.length;
      h.playUntil(handOver, 1);
      notices = notices.concat(h.log.slice(before).flatMap((fx) => fx.flatMap((e) => (e.t === 'SEND' && e.env.t === 'H.NOTICE' ? [e.env.b.code] : []))));
    }
    expect(h.table.phase).toBe('PAUSED');
    expect(notices).toContain('N-PAUSED');
    expect([...h.timers.keys()]).not.toContain('next');
    const v = view(h.table);
    expect(v.hand?.street).toBe('COMPLETE');
    expect(v.result).not.toBeNull();
    expect(v.room.countdownMs).toBeNull();
  });

  it('RESUME while the pause is pending cancels it without a notice; the room keeps dealing', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.cmd({ t: 'PAUSE' });
    h.cmd({ t: 'RESUME' });
    expect(h.table.paused).toBe(false);
    expect(h.notices()).toEqual([]);
    h.playUntil(handOver);
    expect(h.table.phase).toBe('BETWEEN_HANDS');
  });

  it('PAUSE between hands stops at once (countdown cancelled); RESUME deals the next hand + N-RESUMED', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.playUntil(handOver);
    h.cmd({ t: 'PAUSE' });
    expect(h.table.phase).toBe('PAUSED');
    expect(h.notices()).toEqual(['N-PAUSED']);
    expect(h.effects()).toContainEqual({ t: 'TIMER_CANCEL', id: 'next' });
    expect(view(h.table).result).not.toBeNull();
    h.advance(60_000);
    expect(h.table.phase).toBe('PAUSED');
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.notices()).toEqual(['N-RESUMED']);
    expect(h.table.paused).toBe(false);
  });

  it('fewer than 2 seats with chips when the countdown ends -> PAUSED ("waiting for players")', () => {
    const h = new Harness(tableConfig('friend', { seatCount: 3 }));
    h.table = { ...h.table, phase: 'WAITING' }; // friend OPENING -> WAITING is 2-1 (relay registration)
    h.cmd({ t: 'ADD_BOT', seat: null, bot: ruleBot('A') });
    h.cmd({ t: 'START' });
    h.playUntil(handOver);
    for (const s of h.table.seats) if (s && s.kind === 'bot') setSeat(h, s.seat, { stack: 0 });
    h.advance(5000);
    expect(h.table.phase).toBe('PAUSED');
  });

  it('CLOSE after_hand -> CLOSING_AFTER_HAND -> CLOSED at hand end; CLOSE now voids the hand (G-7)', () => {
    const a = practice(5);
    a.cmd({ t: 'START' });
    a.cmd({ t: 'CLOSE', mode: 'after_hand' });
    expect(a.table.phase).toBe('CLOSING_AFTER_HAND');
    a.playUntil((t) => t.phase === 'CLOSED');
    expect(a.table.phase).toBe('CLOSED');

    const b = practice(5);
    b.cmd({ t: 'START' });
    const start = b.table.hand!.startStacks;
    // During a hand the table seats still hold the start-of-hand stacks; the hand state holds the live ones.
    const total = b.table.hand!.seats.reduce((x, p) => x + p.stack + p.committed, 0);
    b.cmd({ t: 'CLOSE', mode: 'now' });
    expect(b.table.phase).toBe('CLOSED');
    expect(b.table.hand!.street).toBe('VOIDED');
    for (const x of start) expect(b.table.seats[x.seat]!.stack).toBe(x.stack);
    expect(b.table.seats.reduce((x, s) => x + (s?.stack ?? 0), 0)).toBe(total);
    expect(total).toBe(60000);
    const closed = b.effects().find((e) => e.t === 'SEND' && e.env.t === 'H.CLOSED');
    expect(closed).toMatchObject({ env: { b: { summary: { reason: 'host_closed_now', voidedHandId: start && b.table.hand!.handId } } } });
  });

  // R0-L17 (re-review N2, lead: accepted as is): finalStack is the table seat stack when the room closes, so the
  // same last hand reports a busted practice bot as 0 (close after this hand) or 10,000 (closed in the countdown,
  // after the D-P4 refill). Pinned so a change is deliberate.
  it('R0-L17: H.CLOSED finalStack = the table seat stack at close (after_hand: as the hand ended; countdown: after D-P4)', () => {
    const summary = (h: Harness) => {
      const closed = h.log.flat().find((e) => e.t === 'SEND' && e.env.t === 'H.CLOSED');
      return closed?.t === 'SEND' && closed.env.t === 'H.CLOSED' ? closed.env.b.summary : null;
    };
    const after = practice(1, { seatCount: 2 }, 'l17-after');
    after.cmd({ t: 'START' });
    after.cmd({ t: 'CLOSE', mode: 'after_hand' });
    shoveDown(after, 'me');
    expect(after.table.phase).toBe('CLOSED');
    const inCountdown = practice(1, { seatCount: 2 }, 'l17-countdown');
    inCountdown.cmd({ t: 'START' });
    shoveDown(inCountdown, 'me');
    expect(inCountdown.table.phase).toBe('BETWEEN_HANDS');
    inCountdown.cmd({ t: 'CLOSE', mode: 'now' });
    for (const [h, botFinal] of [[after, 0], [inCountdown, 10000]] as const) {
      const seats = summary(h)!.seats;
      expect(seats.find((x) => x.seat === 1)!.finalStack).toBe(botFinal);
      expect(seats.find((x) => x.seat === 0)!.finalStack).toBe(20000);
      for (const x of seats) expect(x.finalStack).toBe(h.table.seats[x.seat]!.stack);
    }
  });

  // ---- the whole E-3 table: every (state, input) pair outside it is dropped, state unchanged ----
  // Practice commands are in it too (R0 m2): SIT, REFILL, ADD_BOT, ACT. One seat is left free for ADD_BOT.
  // BUSTED_COUNTDOWN (R0-L16) = BETWEEN_HANDS right after I lost my last chip: SITTING_OUT(bust), stack 0.
  // FRIEND_BUSTED_COUNTDOWN (R0-L33) = the same state in a friend room: the stack-0 rule holds for every room kind (D12).
  const STATES = ['WAITING', 'IN_HAND', 'IN_HAND_PAUSED', 'BETWEEN_HANDS', 'BUSTED_COUNTDOWN', 'FRIEND_BUSTED_COUNTDOWN', 'PAUSED', 'CLOSING_AFTER_HAND', 'CLOSED'] as const;
  type S = (typeof STATES)[number];
  const INPUTS: Record<string, HostCommand> = {
    START: { t: 'START' },
    PAUSE: { t: 'PAUSE' },
    RESUME: { t: 'RESUME' },
    CLOSE_AFTER: { t: 'CLOSE', mode: 'after_hand' },
    CLOSE_NOW: { t: 'CLOSE', mode: 'now' },
    LOCK: { t: 'LOCK', on: true },
    KICK: { t: 'KICK', seat: 1 },
    SET_BLINDS: { t: 'SET_BLINDS', sb: 100, bb: 200 },
    SIT_OUT: { t: 'SIT', mode: 'out' },
    SIT_IN: { t: 'SIT', mode: 'in' }, // ACTIVE in every state but the two busted ones, where stack 0 drops it (R0-L16)
    REFILL: { t: 'REFILL' }, // my stack is > 0 in every state but the two busted ones
    ADD_BOT: { t: 'ADD_BOT', seat: null, bot: ruleBot('Extra') },
    ACT: { t: 'ACT', handId: 'notTheHand', turnSeq: 0, action: { seat: 0, type: 'fold' } },
  };
  const DEFINED: Record<S, Partial<Record<keyof typeof INPUTS, string>>> = {
    WAITING: { START: 'IN_HAND', CLOSE_AFTER: 'CLOSED', CLOSE_NOW: 'CLOSED', SIT_OUT: 'WAITING', ADD_BOT: 'WAITING' },
    IN_HAND: { PAUSE: 'IN_HAND', CLOSE_AFTER: 'CLOSING_AFTER_HAND', CLOSE_NOW: 'CLOSED', SIT_OUT: 'IN_HAND', ADD_BOT: 'IN_HAND' },
    IN_HAND_PAUSED: { RESUME: 'IN_HAND', CLOSE_AFTER: 'CLOSING_AFTER_HAND', CLOSE_NOW: 'CLOSED', SIT_OUT: 'IN_HAND', ADD_BOT: 'IN_HAND' },
    BETWEEN_HANDS: { PAUSE: 'PAUSED', CLOSE_AFTER: 'CLOSED', CLOSE_NOW: 'CLOSED', SIT_OUT: 'BETWEEN_HANDS', ADD_BOT: 'BETWEEN_HANDS' },
    // SIT in is dropped: sitting in with no chips would deal a bots-only hand that pauses again. REFILL is the way back.
    BUSTED_COUNTDOWN: { PAUSE: 'PAUSED', CLOSE_AFTER: 'CLOSED', CLOSE_NOW: 'CLOSED', REFILL: 'BETWEEN_HANDS', ADD_BOT: 'BETWEEN_HANDS' },
    // A busted friend-room host waits for REFILL too; LOCK / KICK / SET_BLINDS stay dropped until 2-1.
    FRIEND_BUSTED_COUNTDOWN: { PAUSE: 'PAUSED', CLOSE_AFTER: 'CLOSED', CLOSE_NOW: 'CLOSED', REFILL: 'BETWEEN_HANDS', ADD_BOT: 'BETWEEN_HANDS' },
    PAUSED: { RESUME: 'IN_HAND', CLOSE_AFTER: 'CLOSED', CLOSE_NOW: 'CLOSED', SIT_OUT: 'PAUSED', ADD_BOT: 'PAUSED' },
    // A second "close after this hand" is dropped silently (no second N-CLOSING-AFTER-HAND).
    CLOSING_AFTER_HAND: { CLOSE_NOW: 'CLOSED', SIT_OUT: 'CLOSING_AFTER_HAND' },
    CLOSED: {},
  };
  // Drop codes other than E-ROOM-BAD-TRANSITION; CLOSED drops everything with E-ROOM-BAD-TRANSITION.
  const DROP_CODE: Partial<Record<keyof typeof INPUTS, string>> = { REFILL: 'E-ROOM-REFILL-NOT-ALLOWED', ACT: 'E-ACT-STALE' };
  const reach = (s: S): Harness => {
    if (s === 'FRIEND_BUSTED_COUNTDOWN') {
      const f = friendWithTwoBots(6, `e3-${s}`);
      f.cmd({ t: 'START' });
      shoveDown(f, 'bots');
      expect(f.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'bust' });
      return f;
    }
    const h = practice(4, { seatCount: 6 }, `e3-${s}`);
    if (s === 'WAITING') return h;
    h.cmd({ t: 'START' });
    if (s === 'IN_HAND') return h;
    if (s === 'IN_HAND_PAUSED') {
      h.cmd({ t: 'PAUSE' });
      return h;
    }
    if (s === 'CLOSING_AFTER_HAND') {
      h.cmd({ t: 'CLOSE', mode: 'after_hand' });
      return h;
    }
    if (s === 'BUSTED_COUNTDOWN') {
      shoveDown(h, 'bots');
      expect(h.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'bust' });
      return h;
    }
    h.playUntil(handOver);
    if (s === 'BETWEEN_HANDS') return h;
    h.cmd({ t: 'PAUSE' });
    if (s === 'PAUSED') return h;
    h.cmd({ t: 'CLOSE', mode: 'now' });
    return h;
  };
  for (const s of STATES) {
    for (const [name, cmd] of Object.entries(INPUTS)) {
      const expected = DEFINED[s][name as keyof typeof INPUTS];
      const dropCode = (s !== 'CLOSED' && DROP_CODE[name as keyof typeof INPUTS]) || 'E-ROOM-BAD-TRANSITION';
      it(`E-3 ${s} x ${name} -> ${expected ?? `dropped (${dropCode})`}`, () => {
        const h = reach(s);
        const phaseBefore = s === 'IN_HAND_PAUSED' ? 'IN_HAND' : s === 'BUSTED_COUNTDOWN' || s === 'FRIEND_BUSTED_COUNTDOWN' ? 'BETWEEN_HANDS' : s;
        expect(h.table.phase).toBe(phaseBefore);
        const before = h.table;
        const snapshot = JSON.stringify(before);
        const r = h.cmd(cmd, 9);
        if (expected === undefined) {
          expect(r.table).toBe(before);
          expect(JSON.stringify(r.table)).toBe(snapshot);
          expect(h.errors()).toEqual([dropCode]);
          // Dropped means: no view, no notice — only the silent error and the NACK for the correlation number.
          expect(r.effects).toEqual([
            { t: 'ERROR', code: dropCode },
            { t: 'SEND', to: 'local', env: { v: 1, t: 'H.NACK', s: 0, b: { c: 9, code: dropCode } } },
          ]);
        } else {
          expect(r.table.phase).toBe(expected);
        }
      });
    }
  }
});

describe('W5-U2 sitout_rule (practice): the only human sitting out stops the room', () => {
  it('SIT out mid-hand: the hand finishes, then PAUSED + N-PAUSED; RESUME sits me back in and deals + N-RESUMED', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.cmd({ t: 'SIT', mode: 'out' });
    expect(h.table.seats[0]!.status).toBe('SITTING_OUT');
    h.playUntil(handOver);
    expect(h.table.phase).toBe('PAUSED');
    expect(h.table.paused).toBe(true);
    h.cmd({ t: 'RESUME' });
    expect(h.table.seats[0]!.status).toBe('ACTIVE');
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.notices()).toEqual(['N-RESUMED']);
  });

  it('SIT in from that pause resumes as well', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.cmd({ t: 'SIT', mode: 'out' });
    h.playUntil(handOver);
    h.cmd({ t: 'SIT', mode: 'in' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.table.seats[0]!.status).toBe('ACTIVE');
  });

  // R0-L3: with my stack at 0 neither RESUME nor SIT in may deal (a bots-only hand would pause again); the screen
  // shows the refill CTA. Both reached by real play: sat out mid-hand, then lost everything in that hand.
  it('R0-L3: sat out and busted -> RESUME and SIT in are dropped silently until REFILL; then RESUME deals me in', () => {
    const h = practice(1, { seatCount: 2 }, 'l3');
    h.cmd({ t: 'START' });
    h.cmd({ t: 'SIT', mode: 'out' });
    shoveDown(h, 'bots');
    expect(h.table.phase).toBe('PAUSED');
    expect(h.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'self' });
    expect(view(h.table).me.canRefill).toBe(true);
    for (const cmd of [{ t: 'RESUME' }, { t: 'SIT', mode: 'in' }] as HostCommand[]) {
      const before = h.table;
      expect(h.cmd(cmd).table).toBe(before);
      expect(h.errors()).toEqual(['E-ROOM-BAD-TRANSITION']);
      expect(h.notices()).toEqual([]);
    }
    h.cmd({ t: 'REFILL' });
    expect(h.table.seats[0]).toMatchObject({ stack: 10000, status: 'SITTING_OUT' }); // self sit-out: refill alone does not sit me in
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.table.seats[0]!.status).toBe('ACTIVE');
    expect(dealt(h.table)).toEqual([0, 1]);
  });

  it('R0-L4 (accepted): during a manual pause SIT out then SIT in resumes the room — I sat back down myself', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.playUntil(handOver);
    h.cmd({ t: 'PAUSE' });
    h.cmd({ t: 'SIT', mode: 'out' });
    expect(h.table).toMatchObject({ phase: 'PAUSED' });
    h.cmd({ t: 'SIT', mode: 'in' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.notices()).toEqual(['N-RESUMED']);
  });
});

// R0-L16 (re-review N1): since M1 a busted me is SITTING_OUT(bust) from hand end, and SIT in during the countdown
// used to be accepted at stack 0 — 3-handed the bots then played a hand without me, heads-up the room paused as
// "waiting for players" without N-PAUSED. Dropped in every phase and room kind (D12); REFILL is the only way back.
// The friend row (R0-L33) keeps that "every room kind" pinned: a busted host there is dealt around, not paused.
describe('R0-L16: SIT in with my stack at 0 is dropped silently (every room kind)', () => {
  const ROWS = [
    { name: 'practice, 2-handed', kind: 'practice', make: () => practice(1, { seatCount: 2 }, 'l16-1') },
    { name: 'practice, 3-handed', kind: 'practice', make: () => practice(2, { seatCount: 3 }, 'l16-2') },
    { name: 'friend room, host + 2 bots', kind: 'friend', make: () => friendWithTwoBots(3, 'l16-friend') },
  ] as const;
  for (const row of ROWS) {
    it(`R0-L16: ${row.name}, busted -> SIT in dropped in the countdown, after it and in PAUSED; REFILL brings me back`, () => {
      const h = row.make();
      h.cmd({ t: 'START' });
      shoveDown(h, 'bots');
      expect(h.table.phase).toBe('BETWEEN_HANDS');
      expect(h.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'bust' });
      const sitInIsDropped = (): void => {
        const before = h.table;
        expect(h.cmd({ t: 'SIT', mode: 'in' }, 4).table).toBe(before);
        expect(h.effects()).toEqual([
          { t: 'ERROR', code: 'E-ROOM-BAD-TRANSITION' },
          { t: 'SEND', to: 'local', env: { v: 1, t: 'H.NACK', s: 0, b: { c: 4, code: 'E-ROOM-BAD-TRANSITION' } } },
        ]);
      };
      sitInIsDropped();
      h.advance(5000);
      expect(h.errors()).toEqual([]);
      if (row.kind === 'practice') {
        // W5-U2: the only human sits out (bust) -> the countdown ends in PAUSED + N-PAUSED.
        expect(h.table.phase).toBe('PAUSED');
        expect(h.notices()).toEqual(['N-PAUSED']);
      } else {
        // sitout_rule is practice only: the bots play on without me, and SIT in stays dropped mid-hand.
        expect(h.table.phase).toBe('IN_HAND');
        expect(dealt(h.table)).not.toContain(0);
        sitInIsDropped();
        h.playUntil(handOver);
        h.cmd({ t: 'PAUSE' });
        expect(h.table.phase).toBe('PAUSED');
      }
      sitInIsDropped(); // PAUSED too (R0-L3)
      h.cmd({ t: 'REFILL' });
      h.cmd({ t: 'RESUME' });
      expect(h.table.phase).toBe('IN_HAND');
      expect(dealt(h.table)).toContain(0);
    });
  }
});

// R0 M1 (review repro d.tt/e.tt): the between-hands seat work used to run only when the countdown ended, so a bot
// busted into a pending pause or a W5-U2 sit-out pause kept 0 chips — heads-up RESUME then failed forever with
// E-ROOM-START-MIN-PLAYERS, 3-handed the bot was skipped. One table for every way out of the hand.
describe('R0 M1: practice bot refill (D-P4) runs at hand end, before the pause branch', () => {
  const ROWS = [
    { name: 'heads-up, no pause -> countdown', bots: 1, stop: null, exit: 'countdown' },
    { name: 'heads-up, pause pending -> RESUME', bots: 1, stop: 'PAUSE', exit: 'RESUME' },
    { name: '3-handed, pause pending -> RESUME', bots: 2, stop: 'PAUSE', exit: 'RESUME' },
    { name: 'heads-up, W5-U2 sat out mid-hand -> SIT in', bots: 1, stop: 'SIT_OUT', exit: 'SIT_IN' },
    { name: '3-handed, W5-U2 sat out mid-hand -> RESUME', bots: 2, stop: 'SIT_OUT', exit: 'RESUME' },
  ] as const;
  for (const row of ROWS) {
    it(`${row.name}: the busted bots are refilled at hand end and dealt into the next hand`, () => {
      const h = practice(row.bots, { seatCount: row.bots + 1 }, `m1-${row.bots}-${row.exit}`);
      h.cmd({ t: 'START' });
      if (row.stop === 'PAUSE') h.cmd({ t: 'PAUSE' });
      if (row.stop === 'SIT_OUT') h.cmd({ t: 'SIT', mode: 'out' });
      shoveDown(h, 'me');
      const busted = h.table.hand!.result!.endStacks.filter((x) => x.seat !== 0 && x.stack === 0).map((x) => x.seat);
      expect(busted).toHaveLength(row.bots);
      for (const seat of busted) expect(h.table.seats[seat]!.stack).toBe(10000);
      expect(h.table.phase).toBe(row.stop === null ? 'BETWEEN_HANDS' : 'PAUSED');
      if (row.exit === 'countdown') h.advance(5000);
      else h.cmd(row.exit === 'RESUME' ? { t: 'RESUME' } : { t: 'SIT', mode: 'in' });
      expect(h.errors()).toEqual([]);
      expect(h.table.phase).toBe('IN_HAND');
      expect(dealt(h.table)).toEqual([0, ...busted]);
    });
  }
});

// R0-L6: friend-room host pause follows the practice rule; sitout_rule stays practice-only.
describe('R0-L6 friend room pause rule (same as practice)', () => {
  const friend = (): Harness => {
    const h = new Harness(tableConfig('friend', { seatCount: 4 }), 'l6');
    h.table = { ...h.table, phase: 'WAITING' }; // friend OPENING -> WAITING is 2-1 (relay registration)
    for (const label of ['A', 'B', 'C']) h.cmd({ t: 'ADD_BOT', seat: null, bot: ruleBot(label) });
    h.cmd({ t: 'START' });
    return h;
  };
  it('RESUME while the pause is pending cancels it without a notice', () => {
    const h = friend();
    h.cmd({ t: 'PAUSE' });
    h.cmd({ t: 'RESUME' });
    expect(h.table).toMatchObject({ phase: 'IN_HAND', paused: false });
    expect(h.errors()).toEqual([]);
    expect(h.notices()).toEqual([]);
  });
  it('a pending pause stops at hand end with no countdown; hand and result stay', () => {
    const h = friend();
    h.cmd({ t: 'PAUSE' });
    h.playUntil(handOver);
    expect(h.table.phase).toBe('PAUSED');
    expect([...h.timers.keys()]).not.toContain('next');
    expect(view(h.table).result).not.toBeNull();
  });
  it('PAUSE between hands stops at once (countdown cancelled)', () => {
    const h = friend();
    h.playUntil(handOver);
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    h.cmd({ t: 'PAUSE' });
    expect(h.table.phase).toBe('PAUSED');
    expect(h.notices()).toEqual(['N-PAUSED']);
    expect(h.effects()).toContainEqual({ t: 'TIMER_CANCEL', id: 'next' });
  });
  it('RESUME deals but never sits a guest back in (sitout_rule is practice only); my own sit-out does not pause', () => {
    const h = friend();
    h.cmd({ t: 'SIT', mode: 'out' });
    h.playUntil(handOver);
    expect(h.table.phase).toBe('BETWEEN_HANDS'); // practice would pause here (W5-U2); friend rooms do not
    h.cmd({ t: 'PAUSE' });
    setSeat(h, 1, { kind: 'human', bot: null, rpk: 'rpkGuestDeviceKey00000', status: 'SITTING_OUT', sitOutReason: 'self' });
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
    expect(h.table.seats[0]!.status).toBe('SITTING_OUT');
    expect(h.table.seats[1]!.status).toBe('SITTING_OUT');
    expect(dealt(h.table)).toEqual([2, 3]);
  });
});

describe('AC-6 turn timer and timeouts (SS9)', () => {
  const myTurn = (h: Harness) => h.playUntil((t) => t.hand?.toAct === 0 && t.phase === 'IN_HAND');

  it('human turn starts a turnSeconds timer; turnMs counts down; timeout = check if possible else fold, auto timeout', () => {
    const h = practice(5, { turnSeconds: 30 });
    h.cmd({ t: 'START' });
    for (let k = 0; k < 20 && h.table.hand?.toAct !== 0; k += 1) h.playUntil((t) => t.hand?.toAct === 0 || handOver(t));
    if (handOver(h.table)) h.advance(5000);
    myTurn(h);
    const id = h.table.turnTimerId!;
    expect(h.timers.get(id)! - h.now).toBe(30000);
    expect(view(h.table).hand!.turnMs).toBe(30000);
    const legal = legalActions(h.table.hand!, 0)!;
    h.advance(30000);
    const entry = h.table.hand!.actions.filter((a) => a.seat === 0 && a.auto === 'timeout');
    expect(entry).toHaveLength(1);
    expect(entry[0]!.type).toBe(legal.check ? 'check' : 'fold');
    expect(h.log.flat().some((e) => e.t === 'ERROR' && e.code === 'E-ACT-TIMEOUT')).toBe(true);
    expect(h.table.seats[0]!.strikes).toBe(1);
  });

  // R0-L14 (MS-R0-3 D3): the shell clock is fractional (performance.now()). turnMs/countdownMs are `int` on the wire;
  // a fraction made validateEnvelope drop the view. ceil alone is not enough: (a + 60000) - a is sometimes
  // 60000.000000000007, which ceil shows as 60001 — the reducer floors the clock read, projection keeps the ceil.
  it('R0-L14 property: fractional clock -> turnMs / countdownMs are whole ms, the full time at the start, never more', () => {
    const r = createSeededRng('frac-ms');
    const frac = () => randomInt(r, 1_000_000) / 1_000_000;
    for (let k = 0; k < 300; k += 1) {
      const h = practice(1, { seatCount: 2 }, `frac-${k}`);
      h.now = randomInt(r, 3_600_000) + frac(); // performance.now() range: the first hour after page load
      h.cmd({ t: 'START' });
      for (let g = 0; g < 10 && h.table.hand?.toAct !== 0; g += 1) h.advance(800 + frac());
      expect(h.table.hand!.toAct).toBe(0);
      expect(view(h.table).hand!.turnMs, `k=${k} turn start`).toBe(60000);
      const due = h.timers.get(h.table.turnTimerId!)!; // the harness's own fractional deadline for this turn
      h.now = Math.max(h.now, due - 60000 + randomInt(r, 59_000) + frac()); // a clock never goes back
      h.cmd({ t: 'SIT', mode: 'out' }); // any accepted input re-reads the clock and re-projects mid-turn
      const mid = view(h.table).hand!.turnMs!;
      expect(Number.isInteger(mid) && mid > 0 && mid <= 60000, `k=${k} mid ${mid}`).toBe(true);
      expect(Math.abs(mid - (due - h.now)), `k=${k}`).toBeLessThanOrEqual(1);
      h.cmd({ t: 'SIT', mode: 'in' });
      h.act('fold');
      h.playUntil(handOver);
      expect(h.table.phase).toBe('BETWEEN_HANDS');
      expect(view(h.table).room.countdownMs).toBe(5000);
      h.now += randomInt(r, 4_900) + frac();
      h.cmd({ t: 'SIT', mode: 'out' });
      const cd = view(h.table).room.countdownMs!;
      expect(Number.isInteger(cd) && cd > 0 && cd <= 5000, `k=${k} countdown ${cd}`).toBe(true);
    }
  });

  it('three timeouts in a row -> SITTING_OUT (stack kept) + N-SITOUT-STRIKES {strikes: 3}; acting resets strikes', () => {
    const h = practice(5, { turnSeconds: 30 });
    h.cmd({ t: 'START' });
    const stacks: number[] = [];
    let strikesNotice: unknown = null;
    for (let n = 0; n < 200 && h.table.seats[0]!.status !== 'SITTING_OUT'; n += 1) {
      const hand = h.table.hand;
      if (hand && hand.toAct === 0 && h.table.phase === 'IN_HAND') {
        const before = h.log.length;
        h.advance(30000);
        for (const fx of h.log.slice(before)) for (const e of fx) if (e.t === 'SEND' && e.env.t === 'H.NOTICE' && e.env.b.code === 'N-SITOUT-STRIKES') strikesNotice = e.env.b.p;
        stacks.push(h.table.seats[0]!.stack);
        continue;
      }
      const next = [...h.timers.values()].sort((a, b) => a - b)[0];
      if (next === undefined) break;
      h.advance(next - h.now);
    }
    expect(h.table.seats[0]!.status).toBe('SITTING_OUT');
    expect(h.table.seats[0]!.strikes).toBe(3);
    expect(strikesNotice).toEqual({ strikes: 3 });
    expect(h.table.seats[0]!.stack).toBeGreaterThan(0);

    const g = practice(5, { turnSeconds: 30 }, 'reset');
    g.cmd({ t: 'START' });
    g.table = { ...g.table, seats: g.table.seats.map((s) => (s?.seat === 0 ? { ...s, strikes: 2 } : s)) };
    myTurn(g);
    const l = legalActions(g.table.hand!, 0)!;
    g.act(l.check ? 'check' : 'call');
    expect(g.table.seats[0]!.strikes).toBe(0);
  });

  it('practice "no limit" (turnSeconds null): no turn timer, no timeout, no strikes even after 10 minutes; turnMs null', () => {
    const h = practice(5, { turnSeconds: null });
    h.cmd({ t: 'START' });
    myTurn(h);
    const turnSeq = h.table.hand!.turnSeq;
    expect(h.log.flat().some((e) => e.t === 'TIMER_START' && e.id.startsWith('turn:'))).toBe(false);
    expect(view(h.table).hand!.turnMs).toBeNull();
    h.advance(600_000);
    expect(h.table.hand!.toAct).toBe(0);
    expect(h.table.hand!.turnSeq).toBe(turnSeq);
    expect(h.table.seats[0]!.strikes).toBe(0);
    expect(h.log.flat().some((e) => e.t === 'ERROR' && e.code === 'E-ACT-TIMEOUT')).toBe(false);
  });

  it('createTable validates turnSeconds per room kind (friend null, practice 15 -> E-ENG-INVALID-INIT; arena unchecked)', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (e) {
        return e instanceof CheckyError ? e.code : 'other';
      }
    };
    expect(code(() => createTable(tableConfig('friend', { turnSeconds: null }), HOST))).toBe('E-ENG-INVALID-INIT');
    expect(code(() => createTable(tableConfig('practice', { turnSeconds: 15 }), HOST))).toBe('E-ENG-INVALID-INIT');
    expect(code(() => createTable(tableConfig('practice', { seatCount: 7 }), HOST))).toBe('E-ENG-INVALID-INIT');
    expect(code(() => createTable(tableConfig('practice', { bb: 10, sb: 50 }), HOST))).toBe('E-ENG-INVALID-INIT');
    expect(code(() => createTable(tableConfig('arena', { turnSeconds: null }), null))).toBeNull();
    expect(code(() => createTable(tableConfig('friend', { turnSeconds: 15 }), HOST))).toBeNull();
  });

  it('bot turns use no human timer: rule bot turnMs is null and it acts after 800..1500 ms of thinking', () => {
    const h = practice(5, { turnSeconds: 30 });
    h.bots = 'manual';
    h.cmd({ t: 'START' });
    for (let guard = 0; guard < 10 && h.table.seats[h.table.hand!.toAct!]!.kind !== 'bot'; guard += 1) {
      const l = legalActions(h.table.hand!, 0)!;
      h.act(l.check ? 'check' : 'call');
    }
    const req = h.effects().find((e) => e.t === 'BOT_REQUEST');
    expect(req).toBeDefined();
    const think = [...h.timers.entries()].find(([id]) => id.startsWith('bot:'))!;
    expect(think[1] - h.now).toBeGreaterThanOrEqual(800);
    expect(think[1] - h.now).toBeLessThanOrEqual(1500);
    expect(view(h.table).hand!.turnMs).toBeNull();
    expect([...h.timers.keys()].some((id) => id.startsWith('turn:'))).toBe(false);
    const seq = h.table.hand!.turnSeq;
    h.answerBot((req as { reqId: string }).reqId);
    expect(h.table.hand!.turnSeq).toBe(seq); // decided, still thinking
    h.advance(think[1] - h.now);
    expect(h.table.hand!.turnSeq).toBeGreaterThan(seq);
  });

  it('a decision for an old request is dropped; an illegal decision falls back to check/fold + E-ACT-ILLEGAL', () => {
    const h = practice(5);
    h.bots = 'manual';
    h.cmd({ t: 'START' });
    for (let guard = 0; guard < 10 && h.table.seats[h.table.hand!.toAct!]!.kind !== 'bot'; guard += 1) {
      const l = legalActions(h.table.hand!, 0)!;
      h.act(l.check ? 'check' : 'call');
    }
    const req = h.effects().find((e) => e.t === 'BOT_REQUEST') as { reqId: string };
    const before = h.table;
    expect(h.answerBot('not-the-request').table).toBe(before);
    h.answerBot(req.reqId, { action: 'raise', amount: 1 });
    h.advance(1500);
    expect(h.log.flat().some((e) => e.t === 'ERROR' && e.code === 'E-ACT-ILLEGAL')).toBe(true);
    const lastBotAction = h.table.hand!.actions.filter((a) => h.table.seats[a.seat]?.kind === 'bot').at(-1)!;
    expect(['check', 'fold']).toContain(lastBotAction.type);
  });
});

describe('AC-5 at table level: ACT staleness and idempotency', () => {
  it('stale handId/turnSeq -> E-ACT-STALE; not my seat -> E-ACT-NOT-YOUR-TURN; the same ACT 3x applies once', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    h.playUntil((t) => t.hand?.toAct === 0);
    const hand = h.table.hand!;
    const before = h.table;
    expect(h.cmd({ t: 'ACT', handId: 'old', turnSeq: hand.turnSeq, action: { seat: 0, type: 'fold' } }, 1).table).toBe(before);
    expect(h.errors()).toEqual(['E-ACT-STALE']);
    expect(h.cmd({ t: 'ACT', handId: hand.handId, turnSeq: hand.turnSeq - 1, action: { seat: 0, type: 'fold' } }).table).toBe(before);
    expect(h.cmd({ t: 'ACT', handId: hand.handId, turnSeq: hand.turnSeq, action: { seat: 1, type: 'fold' } }).table).toBe(before);
    expect(h.errors()).toEqual(['E-ACT-NOT-YOUR-TURN']);
    expect(h.cmd({ t: 'ACT', handId: hand.handId, turnSeq: hand.turnSeq, action: { seat: 0, type: 'raise', to: 1 } }, 2).table).toBe(before);
    expect(h.errors()).toEqual(['E-ACT-AMOUNT']);
    const act: HostCommand = { t: 'ACT', handId: hand.handId, turnSeq: hand.turnSeq, action: { seat: 0, type: 'fold' } };
    h.cmd(act, 3);
    const after = h.table;
    const applied = after.hand?.actions.filter((a) => a.seat === 0 && a.type === 'fold').length ?? 0;
    h.cmd(act, 4);
    expect(h.table).toBe(after);
    expect(h.effects()).toEqual([{ t: 'SEND', to: 'local', env: { v: 1, t: 'H.ACK', s: 0, b: { c: 4 } } }]);
    h.cmd(act, 5);
    expect(h.table.hand?.actions.filter((a) => a.seat === 0 && a.type === 'fold').length ?? 0).toBe(applied);
  });
});

describe('AC-7 refill and busted seats (SS10, US3)', () => {
  it('stack 0 between hands: REFILL approved immediately, 20 times in a row across hands; stack > 0 -> E-ROOM-REFILL-NOT-ALLOWED', () => {
    const h = practice(5);
    h.cmd({ t: 'START' });
    for (let k = 0; k < 20; k += 1) {
      h.playUntil(handOver);
      if (h.table.phase === 'PAUSED') h.resume();
      if (h.table.phase === 'IN_HAND') h.playUntil(handOver);
      setSeat(h, 0, { stack: 0 });
      expect(view(h.table).me.canRefill).toBe(true);
      h.cmd({ t: 'REFILL' }, 100 + k);
      expect(h.table.seats[0]!.stack).toBe(10000);
      expect(h.effects()).toContainEqual({ t: 'SEND', to: 'local', env: { v: 1, t: 'H.ACK', s: 0, b: { c: 100 + k } } });
      if (h.table.phase === 'BETWEEN_HANDS') h.advance(5000);
    }
    const before = h.table;
    expect(h.cmd({ t: 'REFILL' }).table).toBe(before);
    expect(h.errors()).toEqual(['E-ROOM-REFILL-NOT-ALLOWED']);
  });

  it('practice: busting gives N-REFILL-HINT; no refill by countdown end -> SITTING_OUT (bust) -> paused, refill brings me back (D-P12)', () => {
    const h = practice(1, { seatCount: 2, startStack: 10000 });
    h.cmd({ t: 'START' });
    // Rig: I hold 7-2 against aces with 100 chips and shove; the bot (passive) calls.
    setSeat(h, 0, {});
    h.table = { ...h.table, hand: rig({ ...h.table.hand!, seats: h.table.hand!.seats.map((p) => (p.seat === 0 ? { ...p, stack: p.stack - (p.stack + p.committed - 100) } : p)) }, { 0: ['7c', '2d'], 1: ['As', 'Ah'] }, ['Kd', 'Qh', '9s', '4c', '3h']) };
    h.table = { ...h.table, hand: { ...h.table.hand!, startStacks: h.table.hand!.startStacks.map((x) => (x.seat === 0 ? { seat: 0, stack: 100 } : x)) } };
    let hint = false;
    for (let guard = 0; guard < 20 && !handOver(h.table); guard += 1) {
      if (h.table.hand!.toAct === 0) h.act('allin', legalActions(h.table.hand!, 0)!.allIn.to);
      else h.advance(1500);
      hint ||= h.notices().includes('N-REFILL-HINT');
    }
    expect(h.table.seats[0]!.stack).toBe(0);
    expect(hint).toBe(true);
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    h.advance(5000);
    expect(h.table.seats[0]).toMatchObject({ status: 'SITTING_OUT', sitOutReason: 'bust' });
    expect(h.table.phase).toBe('PAUSED');
    // Resuming while busted would deal a bots-only hand and pause again: refused until I refill.
    const busted = h.table;
    expect(h.cmd({ t: 'RESUME' }).table).toBe(busted);
    expect(h.errors()).toEqual(['E-ROOM-BAD-TRANSITION']);
    h.cmd({ t: 'REFILL' });
    expect(h.table.seats[0]).toMatchObject({ status: 'ACTIVE', stack: 10000 });
    h.cmd({ t: 'RESUME' });
    expect(h.table.phase).toBe('IN_HAND');
  });

  it('practice: a REFILL during the countdown brings a busted me back without pausing (D-P12)', () => {
    const h = practice(1, { seatCount: 2 }, 'refill-window');
    h.cmd({ t: 'START' });
    shoveDown(h, 'bots');
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    expect(h.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'bust' });
    h.cmd({ t: 'REFILL' });
    expect(h.table.seats[0]).toMatchObject({ stack: 10000, status: 'ACTIVE' });
    h.advance(5000);
    expect(h.table.phase).toBe('IN_HAND');
    expect(dealt(h.table)).toEqual([0, 1]);
  });

  // R0-L15 (MS-R0-3 D6): between hands the seat showed the finished hand's stack (0) after a REFILL, so the screen
  // kept "0 · All-in" and never confirmed the refill. Outside a running hand occupant.stack = the table seat stack;
  // the retained hand and result keep the hand's own values.
  it('R0-L15: bust -> REFILL (countdown and PAUSED) -> the very next view shows the start stack, canRefill false', () => {
    for (const where of ['countdown', 'paused'] as const) {
      const h = practice(2, { seatCount: 3 }, `l15-${where}`);
      h.cmd({ t: 'START' });
      if (where === 'paused') h.cmd({ t: 'PAUSE' });
      shoveDown(h, 'bots');
      expect(h.table.phase).toBe(where === 'paused' ? 'PAUSED' : 'BETWEEN_HANDS');
      const busted = view(h.table);
      expect(busted.seats[0]!.occupant!.stack).toBe(0);
      expect(busted.me.canRefill).toBe(true);
      h.cmd({ t: 'REFILL' });
      const v = view(h.table);
      expect(v.seats[0]!.occupant!.stack, where).toBe(10000);
      expect(v.me.canRefill, where).toBe(false);
      // The finished hand stays as it was played.
      expect(v.result!.endStacks.find((x) => x.seat === 0)!.stack).toBe(0);
      expect(v.seats[0]!.occupant!.inHand).toMatchObject({ allIn: true });
      expect(v.hand!.startStacks.find((x) => x.seat === 0)!.stack).toBe(busted.hand!.startStacks.find((x) => x.seat === 0)!.stack);
      // Bots refilled at hand end (D-P4) show their table stack too; every seat = the table, not the hand.
      for (const s of v.seats) if (s.occupant) expect(s.occupant.stack).toBe(h.table.seats[s.seat]!.stack);
    }
  });

  it('R0-L15: while a hand runs (IN_HAND and CLOSING_AFTER_HAND) occupant.stack is the live chips behind', () => {
    const h = practice(2, { seatCount: 3 }, 'l15-live');
    h.cmd({ t: 'START' });
    for (const phase of ['IN_HAND', 'CLOSING_AFTER_HAND'] as const) {
      if (phase === 'CLOSING_AFTER_HAND') h.cmd({ t: 'CLOSE', mode: 'after_hand' });
      expect(h.table.phase).toBe(phase);
      const hand = h.table.hand!;
      for (const s of view(h.table).seats) {
        if (s.occupant === null) continue;
        const live = hand.seats.find((p) => p.seat === s.seat)!.stack;
        expect(s.occupant.stack).toBe(live);
        expect(live).toBeLessThanOrEqual(h.table.seats[s.seat]!.stack); // the table seat keeps the start-of-hand stack
      }
    }
  });

  it('friend room: a busted seat that does not refill gets no cards, blinds or pot next hand (R9, B-E5)', () => {
    const h = friendWithTwoBots(3);
    h.cmd({ t: 'START' });
    shoveDown(h, 'bots');
    // Busted at hand end -> SITTING_OUT at once; friend rooms keep counting down (sitout_rule is practice only).
    expect(h.table.phase).toBe('BETWEEN_HANDS');
    expect(h.table.seats[0]).toMatchObject({ stack: 0, status: 'SITTING_OUT', sitOutReason: 'bust' });
    h.advance(5000);
    expect(h.table.phase).toBe('IN_HAND');
    const hand = h.table.hand!;
    expect(hand.seats.map((p) => p.seat)).not.toContain(0);
    expect(hand.actions.some((a) => a.seat === 0)).toBe(false);
    expect(view(h.table).me.holeCards).toBeNull();
  });

  it('there is no chip transfer, carry-over or exchange command or message (G-3)', () => {
    type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
    const commands: Equal<
      HostCommand['t'],
      'START' | 'PAUSE' | 'RESUME' | 'CLOSE' | 'LOCK' | 'KICK' | 'SET_BLINDS' | 'SET_OPTION' | 'ADD_BOT' | 'UPDATE_BOT' | 'REMOVE_BOT' | 'ACT' | 'SIT' | 'REFILL' | 'CHAT'
    > = true;
    expect(commands).toBe(true);
  });
});

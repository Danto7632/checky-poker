// TableAnnouncer (components.md 3.13): other seats' actions are read at most once per second, leading + trailing —
// the last action inside the second is read when it ends (review m6) — and a newer announcement cancels a pending one.
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionLogEntry, PlayerView } from '@checky/engine/protocol';
import { renderI18n } from '../testing/render';
import { fakeView } from '../testing/table-fixtures';
import { TableAnnouncer } from './TableAnnouncer';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const base = fakeView('practice-my-turn');
const hand = base.hand!;
const me = base.me.seat!;
const others = base.seats.filter((s) => s.occupant !== null && !s.occupant.isMe).map((s) => s.seat);
const nameOf = (seat: number) => base.seats.find((s) => s.seat === seat)!.occupant!.name;

/** A snapshot where it is not my turn and `extra` actions by other seats follow the fixture's log. */
function withActions(extra: Pick<ActionLogEntry, 'seat' | 'type' | 'to' | 'added'>[], over: Partial<PlayerView['hand'] & object> = {}): PlayerView {
  const actions = [...hand.actions, ...extra.map((a, k) => ({ ...a, i: hand.actions.length + k, street: hand.street }))];
  return { ...base, me: { ...base.me, legal: null }, hand: { ...hand, ...over, toAct: others[0]!, turnSeq: hand.turnSeq + extra.length, actions } };
}

const polite = () => screen.getByTestId('T-01.announcePolite').textContent;
/** The polite region's lines in reading (DOM) order. */
const lines = () => [...screen.getByTestId('T-01.announcePolite').querySelectorAll('p')].map((p) => p.textContent);

/** The snapshot right after `extra` actions, in which the engine has handed the turn to me (one view, R0-L21). */
function myTurnAfter(extra: Pick<ActionLogEntry, 'seat' | 'type' | 'to' | 'added'>[], over: Partial<PlayerView['hand'] & object> = {}): PlayerView {
  const v = withActions(extra, over);
  return { ...v, me: base.me, hand: { ...v.hand!, toAct: me, turnSeq: v.hand!.turnSeq + 1 } };
}
const toCall = base.me.legal!.call!.amount;

describe('TableAnnouncer action throttle', () => {
  it('reads the first action at once and the LAST one of the same second when it ends (trailing)', () => {
    const [a, b] = [others[0]!, others[1]!];
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={withActions([{ seat: a, type: 'call', to: 100, added: 100 }])} myTurn={null} />);
    expect(polite()).toBe(`${nameOf(a)}: Called 100`);
    act(() => vi.advanceTimersByTime(300));
    rerender(<TableAnnouncer view={withActions([{ seat: a, type: 'call', to: 100, added: 100 }, { seat: b, type: 'raise', to: 400, added: 400 }])} myTurn={null} />);
    expect(polite()).toBe(`${nameOf(a)}: Called 100`); // inside the second: held back
    act(() => vi.advanceTimersByTime(699));
    expect(polite()).toBe(`${nameOf(a)}: Called 100`);
    act(() => vi.advanceTimersByTime(1));
    expect(polite()).toBe(`${nameOf(b)}: Raised to 400`);
  });

  it('a newer announcement (a new board) cancels the pending action, so nothing is read out of order', () => {
    const [a, b] = [others[0]!, others[1]!];
    const first = withActions([{ seat: a, type: 'call', to: 100, added: 100 }]);
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={first} myTurn={null} />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<TableAnnouncer view={withActions([{ seat: a, type: 'call', to: 100, added: 100 }, { seat: b, type: 'check', to: 100, added: 0 }])} myTurn={null} />);
    const flop = withActions([{ seat: a, type: 'call', to: 100, added: 100 }, { seat: b, type: 'check', to: 100, added: 0 }], {
      board: ['Ah', 'Kd', '7c'],
    });
    rerender(<TableAnnouncer view={flop} myTurn={null} />);
    const boardLine = polite();
    expect(boardLine).toMatch(/Ace/);
    act(() => vi.advanceTimersByTime(2000));
    expect(polite()).toBe(boardLine);
  });

  it('my own actions are never read back', () => {
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={withActions([{ seat: me, type: 'fold', to: 0, added: 0 }])} myTurn={null} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(polite()).toBe('');
  });
});

describe('TableAnnouncer: the snapshot that hands me the turn (R0-L21, review N-1)', () => {
  it('a raise to me is read first, then the turn line — one polite update, in that order', () => {
    const rex = others[0]!;
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={myTurnAfter([{ seat: rex, type: 'raise', to: 2400, added: 2400 }])} myTurn={null} />);
    expect(lines()).toEqual([`${nameOf(rex)}: Raised to 2,400`, `Your turn. To call ${toCall}.`]);
    act(() => vi.advanceTimersByTime(2000)); // nothing trails behind it
    expect(lines()).toEqual([`${nameOf(rex)}: Raised to 2,400`, `Your turn. To call ${toCall}.`]);
  });

  it('inside the one-second action window the turn is still read at once, with the action that handed it over', () => {
    const [a, b] = [others[0]!, others[1]!];
    const call = { seat: a, type: 'call', to: 100, added: 100 } as const;
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={withActions([call])} myTurn={null} />);
    act(() => vi.advanceTimersByTime(200));
    rerender(<TableAnnouncer view={myTurnAfter([call, { seat: b, type: 'raise', to: 400, added: 400 }])} myTurn={null} />);
    expect(lines()).toEqual([`${nameOf(b)}: Raised to 400`, `Your turn. To call ${toCall}.`]);
  });

  it('the call that closes the street, the new board and my turn: action, board, turn', () => {
    const rex = others[0]!;
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={myTurnAfter([{ seat: rex, type: 'call', to: 100, added: 100 }], { board: ['Ah', 'Kd', '7c'] })} myTurn={null} />);
    const [action, board, turn] = lines();
    expect(action).toBe(`${nameOf(rex)}: Called 100`);
    expect(board).toMatch(/^Board: .*Ace/);
    expect(turn).toBe(`Your turn. To call ${toCall}.`);
  });

  it('my turn without a new action from someone else reads the turn line alone', () => {
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    rerender(<TableAnnouncer view={myTurnAfter([])} myTurn={null} />);
    expect(lines()).toEqual([`Your turn. To call ${toCall}.`]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// R0-L26 (MS-R0-3 run 2 D-R2-2 + the polite audit): a live region speaks only what changes in its DOM, so a sentence
// that repeats what the region already shows has to be put in again as new nodes, after the region was empty.
// "Read" below = a mutation that inserts the sentence (a node added with that text, or a text node changed to it).
// ---------------------------------------------------------------------------------------------------------------
describe('TableAnnouncer: repeats are inserted again, so they are read again (R0-L26)', () => {
  const WARN = '5 seconds left';

  /** Every DOM change inside one region, kept from the observer callback and from takeRecords(). */
  function watchRegion(testId: string) {
    const el = screen.getByTestId(testId);
    const records: MutationRecord[] = [];
    const mo = new MutationObserver((rs) => records.push(...rs));
    mo.observe(el, { childList: true, subtree: true, characterData: true, characterDataOldValue: true });
    /**
     * The text a node held right after record `i`: records are read after the fact, so a later in-place edit of the
     * same line (index keys: "Pausing …" -> "Pause cancelled" in one <p>) is undone through that edit's oldValue.
     */
    const textAfter = (node: Node, i: number) =>
      records.slice(i + 1).find((r) => r.type === 'characterData' && node.contains(r.target))?.oldValue ?? node.textContent;
    return {
      /** How many times `text` was put into the region as a whole line. */
      reads(text: string): number {
        records.push(...mo.takeRecords());
        return records.filter((r, i) =>
          r.type === 'characterData' ? textAfter(r.target, i) === text : [...r.addedNodes].some((n) => textAfter(n, i) === text),
        ).length;
      },
      text: () => el.textContent,
    };
  }

  /** My timed turn number `k` (k = 0, 1, …): a new turnSeq each time, as the engine gives it. */
  const myTurnView = (k: number): PlayerView => ({ ...base, hand: { ...hand, toAct: me, turnSeq: hand.turnSeq + 2 * k } });
  /** Someone else's turn between two of mine. */
  const theirTurnView = (k: number): PlayerView => ({ ...base, me: { ...base.me, legal: null }, hand: { ...hand, toAct: others[0]!, turnSeq: hand.turnSeq + 2 * k + 1 } });
  const clock = { remainingMs: 7000, totalMs: 60000 };

  it('two timed turns in a row: the 5-second warning changes the assertive region twice', () => {
    const { rerender } = renderI18n(<TableAnnouncer view={myTurnView(0)} myTurn={clock} />);
    const assertive = watchRegion('T-01.announceAssertive');
    act(() => vi.advanceTimersByTime(2500));
    expect(assertive.text()).toBe(WARN);
    expect(assertive.reads(WARN)).toBe(1);
    // My action hands the turn on: the region is emptied for the next turn.
    rerender(<TableAnnouncer view={theirTurnView(0)} myTurn={null} />);
    expect(assertive.text()).toBe('');
    act(() => vi.advanceTimersByTime(3000));
    rerender(<TableAnnouncer view={myTurnView(1)} myTurn={clock} />);
    act(() => vi.advanceTimersByTime(1500));
    expect(assertive.text()).toBe(''); // 5.5 s left: no warning yet
    act(() => vi.advanceTimersByTime(1000));
    expect(assertive.text()).toBe(WARN);
    expect(assertive.reads(WARN)).toBe(2);
  });

  it('a turn that starts with 5 s or less right after my previous warned turn is still a new insertion', () => {
    const { rerender } = renderI18n(<TableAnnouncer view={myTurnView(0)} myTurn={clock} />);
    const assertive = watchRegion('T-01.announceAssertive');
    act(() => vi.advanceTimersByTime(2500));
    rerender(<TableAnnouncer view={myTurnView(1)} myTurn={{ remainingMs: 4000, totalMs: 60000 }} />);
    expect(assertive.text()).toBe(''); // cleared and waiting to be refilled
    act(() => vi.advanceTimersByTime(100));
    expect(assertive.text()).toBe(WARN);
    expect(assertive.reads(WARN)).toBe(2);
  });

  it('the first render of a new 60 s turn after a warned turn does not warn early (no stale count)', () => {
    const { rerender } = renderI18n(<TableAnnouncer view={myTurnView(0)} myTurn={clock} />);
    const assertive = watchRegion('T-01.announceAssertive');
    act(() => vi.advanceTimersByTime(4000));
    expect(assertive.reads(WARN)).toBe(1);
    rerender(<TableAnnouncer view={myTurnView(1)} myTurn={{ remainingMs: 60000, totalMs: 60000 }} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(assertive.text()).toBe('');
    expect(assertive.reads(WARN)).toBe(1);
  });

  // Keep playing reads "Pause cancelled" in between (ui-spec T-01 pause table); Resume from PAUSED reads nothing, so
  // the second "Paused" is a true repeat and goes through the empty moment.
  it.each([
    ['"Pausing before the next hand" after Keep playing -> Pause', 'Pausing before the next hand', 'Pause cancelled', { paused: true, phase: 'IN_HAND' }, { paused: false, phase: 'IN_HAND' }],
    ['"Paused" after Resume -> Pause between hands', 'Paused', 'Paused', { paused: true, phase: 'PAUSED' }, { paused: false, phase: 'BETWEEN_HANDS' }],
  ] as const)('%s is read twice', (_, line, between, on, off) => {
    const room = (r: { paused: boolean; phase: PlayerView['room']['phase'] }): PlayerView => ({ ...base, me: { ...base.me, legal: null }, hand: { ...hand, toAct: others[0]! }, room: { ...base.room, ...r } });
    const { rerender } = renderI18n(<TableAnnouncer view={room(off)} myTurn={null} />);
    const polite = watchRegion('T-01.announcePolite');
    rerender(<TableAnnouncer view={room(on)} myTurn={null} />);
    expect(polite.reads(line)).toBe(1);
    rerender(<TableAnnouncer view={room(off)} myTurn={null} />);
    expect(polite.text()).toBe(between);
    rerender(<TableAnnouncer view={room(on)} myTurn={null} />);
    act(() => vi.advanceTimersByTime(100));
    expect(polite.text()).toBe(line);
    expect(polite.reads(line)).toBe(2);
  });

  it('"Pause cancelled" is read on every Pause -> Keep playing', () => {
    const inHand = (paused: boolean): PlayerView => ({ ...withActions([]), room: { ...base.room, paused, phase: 'IN_HAND' } });
    const { rerender } = renderI18n(<TableAnnouncer view={inHand(false)} myTurn={null} />);
    const polite = watchRegion('T-01.announcePolite');
    for (const k of [1, 2]) {
      rerender(<TableAnnouncer view={inHand(true)} myTurn={null} />);
      rerender(<TableAnnouncer view={inHand(false)} myTurn={null} />);
      expect([polite.text(), polite.reads('Pause cancelled')]).toEqual(['Pause cancelled', k]);
    }
  });

  it('"Your turn. To call N." with the same amount twice in a row is read twice', () => {
    const turnLine = `Your turn. To call ${toCall}.`;
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    const polite = watchRegion('T-01.announcePolite');
    rerender(<TableAnnouncer view={myTurnAfter([])} myTurn={null} />);
    expect(polite.reads(turnLine)).toBe(1);
    // My call (never read back), then the turn comes back to me at the same price in the next snapshot.
    const mine = myTurnAfter([{ seat: me, type: 'call', to: 100, added: 100 }]);
    rerender(<TableAnnouncer view={{ ...mine, hand: { ...mine.hand!, turnSeq: mine.hand!.turnSeq + 1 } }} myTurn={null} />);
    act(() => vi.advanceTimersByTime(100));
    expect(polite.reads(turnLine)).toBe(2);
  });

  it('a multi-line update that repeats lines in place (check-check, next street, my turn) reads every line', () => {
    const rex = others[0]!;
    const check = { seat: rex, type: 'check', to: 0, added: 0 } as const;
    const flop = myTurnAfter([check], { board: ['Ah', 'Kd', '7c'] });
    const { rerender } = renderI18n(<TableAnnouncer view={withActions([])} myTurn={null} />);
    const polite = watchRegion('T-01.announcePolite');
    rerender(<TableAnnouncer view={flop} myTurn={null} />);
    const [actionLine, , turnLine] = lines();
    // I check (not read); Rex checks; the turn card comes and it is my turn again — the same action and turn lines.
    const turnCard = myTurnAfter([check, { seat: me, type: 'check', to: 0, added: 0 }, check], { board: ['Ah', 'Kd', '7c', '2s'], turnSeq: flop.hand!.turnSeq + 1 });
    rerender(<TableAnnouncer view={turnCard} myTurn={null} />);
    act(() => vi.advanceTimersByTime(100));
    expect(lines()).toHaveLength(3);
    expect(polite.reads(actionLine!)).toBe(2);
    expect(polite.reads(turnLine!)).toBe(2);
  });

  it('a new announcement during the empty moment wins; nothing stale is refilled after it', () => {
    const room = (r: { paused: boolean; phase: PlayerView['room']['phase'] }): PlayerView => ({ ...withActions([]), room: { ...base.room, ...r } });
    const { rerender } = renderI18n(<TableAnnouncer view={room({ paused: false, phase: 'BETWEEN_HANDS' })} myTurn={null} />);
    rerender(<TableAnnouncer view={room({ paused: true, phase: 'PAUSED' })} myTurn={null} />);
    rerender(<TableAnnouncer view={room({ paused: false, phase: 'BETWEEN_HANDS' })} myTurn={null} />); // Resume
    rerender(<TableAnnouncer view={room({ paused: true, phase: 'PAUSED' })} myTurn={null} />); // repeat -> empty, refill pending
    expect(polite()).toBe('');
    rerender(<TableAnnouncer view={myTurnAfter([])} myTurn={null} />); // Resume again: the next hand hands me the turn
    expect(polite()).toBe(`Your turn. To call ${toCall}.`);
    act(() => vi.advanceTimersByTime(500));
    expect(polite()).toBe(`Your turn. To call ${toCall}.`);
  });

  // fix3 review O-10 (mutation K7): refills still waiting when the table goes away are cancelled with it.
  it('unmounting with a refill waiting in both regions leaves no timer behind', () => {
    const { rerender, unmount } = renderI18n(<TableAnnouncer view={theirTurnView(0)} myTurn={null} />);
    rerender(<TableAnnouncer view={myTurnView(1)} myTurn={clock} />);
    act(() => vi.advanceTimersByTime(2500)); // "Your turn. To call N." and "5 seconds left" are shown
    rerender(<TableAnnouncer view={myTurnView(2)} myTurn={{ remainingMs: 4000, totalMs: 60000 }} />); // both repeat
    expect([screen.getByTestId('T-01.announcePolite').textContent, screen.getByTestId('T-01.announceAssertive').textContent]).toEqual(['', '']);
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

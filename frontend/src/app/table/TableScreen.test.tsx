// TableScreen with Phillip's fake scenarios (A-SES-FAKE): the practice states of ui-spec T-01 — my turn, No limit,
// pause pending / paused, engine alert, showdown + countdown, sitting out, loading — plus the practice menu.
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClient, type FakeClient } from '@/session';
import { readRepoFile } from '../testing/node-fs';
import { renderI18n } from '../testing/render';
import { fakeView, sittingOutClient } from '../testing/table-fixtures';
import { LAYOUT_A, seatPointB, type Point } from './layout';
import { TableLayout } from './TableLayout';
import { TableScreen } from './TableScreen';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * practice-busted (Phillip's fake for the R0-L3 state: PAUSED, my stack 0, SITTING_OUT, canRefill) with a single bot
 * left, so fewer than two seats have chips — the refill must still be offered, not "Waiting for players".
 */
function headsUpBustedClient(): FakeClient {
  const base = createFakeClient('practice-busted');
  const snap = base.getSnapshot();
  const v = snap.view!;
  let bots = 0;
  const seats = v.seats.map((s) => {
    if (s.occupant === null || s.occupant.isMe) return s;
    bots += 1;
    return bots > 1 ? { ...s, occupant: null } : s;
  });
  // One stable snapshot object: useSyncExternalStore re-renders forever if getSnapshot returns a new one each call.
  const headsUp = { ...snap, view: { ...v, seats } };
  return { ...base, getSnapshot: () => headsUp };
}

function setup(scenario: string, client: FakeClient = createFakeClient(scenario)) {
  const onLeave = vi.fn();
  const onRestart = vi.fn();
  const onLiveOdds = vi.fn();
  renderI18n(<TableScreen client={client} computeMetrics={undefined} liveOdds={false} onLiveOdds={onLiveOdds} onLeave={onLeave} onRestart={onRestart} />);
  const count = (method: string) => client.calls.filter((c) => c.method === method).length;
  return { client, onLeave, onRestart, onLiveOdds, count };
}

describe('TableScreen (practice)', () => {
  it('practice-my-turn: practice HUD chip, action bar from legal, my turn ring (60 s)', () => {
    setup('practice-my-turn');
    expect(screen.getByTestId('T-01.roomChip').textContent).toBe('Practice · 50/100');
    expect(screen.getByTestId('T-01.call').textContent).toContain('Call 100');
    expect(screen.getByTestId('T-01.raise')).toBeTruthy();
    expect(screen.getByText('Your turn').textContent).toMatch(/Your turn · \d+s/);
    expect(within(screen.getByTestId('T-01.seat0')).getByTestId('T-01.turnTimer')).toBeTruthy();
    expect(screen.getByTestId('T-01.seat0').getAttribute('aria-label')).toMatch(/^Seat 1, .+, [\d,]+ chips, to act, \d+ seconds left$/);
  });

  it('practice-no-limit: no TurnTimer anywhere, "Your turn" only, no seconds in the seat label', () => {
    setup('practice-no-limit');
    expect(screen.queryAllByTestId('T-01.turnTimer')).toHaveLength(0);
    expect(screen.getByText('Your turn').textContent).toBe('Your turn');
    expect(screen.getByTestId('T-01.seat0').getAttribute('aria-label')).toMatch(/, to act$/);
  });

  it('practice-pausing: pending HUD with Keep playing -> resume()', () => {
    const { count } = setup('practice-pausing');
    expect(screen.getByTestId('T-01.pauseControl').dataset.state).toBe('pending');
    fireEvent.click(screen.getByTestId('T-01.pauseButton'));
    expect(count('resume')).toBe(1);
    expect(count('pause')).toBe(0);
  });

  it('practice-paused: "Paused" pill + Resume, last result still shown (F-JN-05)', () => {
    const { count } = setup('practice-paused');
    expect(screen.getByTestId('T-01.pausedPill').textContent).toContain('Paused');
    expect(screen.getByTestId('T-02.result')).toBeTruthy();
    fireEvent.click(screen.getByTestId('T-01.resumePill'));
    expect(count('resume')).toBe(1);
  });

  // R0-L3 + R0-L25 (V5): stopped on my empty stack, the slot's T-06 card is the one visible refill button — none in
  // the HUD, the felt or my area, no Resume anywhere, P does nothing; the menu sheet has one refill row with the
  // "free, as many times as you like" sentence. Heads-up too: the card, not "Waiting for players".
  it.each([false, true])('practice-busted (headsUp=%s): one visible "Get chips again" (the T-06 card) -> refill(); one in the sheet', async (headsUp) => {
    const { count } = setup('practice-busted', headsUp ? headsUpBustedClient() : undefined);
    expect(screen.getAllByRole('button', { name: 'Get chips again' })).toHaveLength(1);
    expect(within(screen.getByTestId('T-01.slot')).getByTestId('T-06.refill')).toBeTruthy();
    expect(screen.getByTestId('T-06.card').textContent).toContain('Paused'); // the pill's words, now on the card
    expect(screen.queryByTestId('T-01.pauseControl')).toBeNull();
    expect(screen.queryByTestId('T-01.pausedPill')).toBeNull();
    expect(screen.queryByTestId('T-01.refillPill')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByTestId('T-01.sitIn')).toBeNull();
    fireEvent.keyDown(window, { key: 'p' }); // P would send a RESUME the engine drops: it does nothing here
    fireEvent.click(screen.getByTestId('T-06.refill'));
    expect(count('refill')).toBe(1);
    expect(count('resume')).toBe(0);
    expect(count('pause')).toBe(0);
    expect(count('sit')).toBe(0);
    fireEvent.click(screen.getByTestId('T-01.menu'));
    const sheet = await screen.findByTestId('T-05.sheet');
    expect(within(sheet).queryByTestId('T-05.resume')).toBeNull();
    expect(within(sheet).getAllByRole('button', { name: 'Get chips again' })).toHaveLength(1);
    const row = within(sheet).getByTestId('T-05.refill');
    const body = document.getElementById(row.getAttribute('aria-describedby') ?? '');
    expect(body?.textContent).toBe('Get 10,000 chips again — free, as many times as you like.');
    await act(async () => {
      fireEvent.click(row);
    });
    expect(count('refill')).toBe(2);
    expect(count('resume')).toBe(0);
  });

  it('alert (E-ENG-INVARIANT): voided-hand screen with Resume, Start again and Leave — never "room closed"', () => {
    const { count, onRestart, onLeave } = setup('alert');
    const alert = screen.getByTestId('T-01.alert');
    expect(alert.textContent).toContain('Something went wrong, so we voided this hand');
    expect(alert.textContent).not.toMatch(/closed/i);
    fireEvent.click(screen.getByTestId('T-01.alertResume'));
    expect(count('resume')).toBe(1);
    fireEvent.click(screen.getByTestId('T-01.alertRestart'));
    expect(onRestart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('T-01.alertLeave'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('E-ENG-INVARIANT')).toBeTruthy();
  });

  it('showdown: result panel and "Next hand in 5" with Pause next to it', () => {
    const { count } = setup('showdown');
    expect(screen.getByTestId('T-02.result')).toBeTruthy();
    expect(screen.getByTestId('T-01.countdown').textContent).toContain('Next hand in 5');
    fireEvent.click(screen.getByTestId('T-01.pauseCountdown'));
    expect(count('pause')).toBe(1);
  });

  it('sitting-out: the slot card with Sit back in -> sit("in")', () => {
    const { count, client } = setup('sitting-out', sittingOutClient());
    fireEvent.click(screen.getByTestId('T-01.sitIn'));
    expect(count('sit')).toBe(1);
    expect(client.calls.find((c) => c.method === 'sit')?.args).toEqual(['in']);
  });

  it('keyboard P pauses while running; shortcuts can be switched off in the menu', async () => {
    const { count } = setup('practice-my-turn');
    fireEvent.keyDown(window, { key: 'p' });
    expect(count('pause')).toBe(1);
    fireEvent.click(screen.getByTestId('T-01.menu'));
    await act(async () => {
      fireEvent.click(await screen.findByTestId('T-05.shortcuts'));
    });
    fireEvent.keyDown(window, { key: 'p' });
    expect(count('pause')).toBe(1);
  });

  it('shortcuts are off behind the Leave confirmation (focus on Stay) and work again once it closes (review M2)', async () => {
    const { count } = setup('practice-my-turn');
    fireEvent.click(screen.getByTestId('T-01.leave'));
    await screen.findByTestId('T-01.leaveDialog');
    const stay = document.activeElement;
    expect(stay?.textContent).toBe('Stay');
    for (const key of ['f', 'c', 'r', 'p']) fireEvent.keyDown(stay ?? window, { key });
    expect(count('act')).toBe(0);
    expect(count('pause')).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByText('Stay'));
    });
    expect(screen.queryByTestId('T-01.leaveDialog')).toBeNull();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'f' });
    });
    expect(count('act')).toBe(1);
  });

  it('shortcuts are off while the menu sheet is open, including keys typed inside it (review M2)', async () => {
    const { count } = setup('practice-my-turn');
    fireEvent.click(screen.getByTestId('T-01.menu'));
    const sheet = await screen.findByTestId('T-05.sheet');
    fireEvent.keyDown(window, { key: 'f' });
    fireEvent.keyDown(within(sheet).getByTestId('T-05.leave'), { key: 'c' });
    fireEvent.keyDown(sheet, { key: 'p' });
    expect(count('act')).toBe(0);
    expect(count('pause')).toBe(0);
  });

  it('practice menu: room facts, play-money line, Game section with Pause, Live odds and Bot chatter', async () => {
    const { count, onLiveOdds } = setup('practice-my-turn');
    fireEvent.click(screen.getByTestId('T-01.menu'));
    const sheet = await screen.findByTestId('T-05.sheet');
    expect(sheet.textContent).toContain('Blinds 50/100');
    expect(sheet.textContent).toContain('Starting chips 10,000');
    expect(sheet.textContent).toContain('Time per turn 60s');
    expect(sheet.textContent).toContain('Chips are play money — no cash value');
    expect(sheet.textContent).not.toMatch(/Lock room|Copy invite|Remove/);
    fireEvent.click(within(sheet).getByTestId('T-05.chatter'));
    expect(count('setOption')).toBe(1);
    fireEvent.click(within(sheet).getByTestId('T-05.liveOdds'));
    expect(onLiveOdds).toHaveBeenCalledWith(true);
    fireEvent.click(within(sheet).getByTestId('T-05.pause'));
    expect(count('pause')).toBe(1);
  });

  it('No-limit menu shows "Time per turn: No limit"', async () => {
    setup('practice-no-limit');
    fireEvent.click(screen.getByTestId('T-01.menu'));
    expect((await screen.findByTestId('T-05.sheet')).textContent).toContain('Time per turn: No limit');
  });

  it('view === null: nothing for 300 ms, then seat skeletons', () => {
    vi.useFakeTimers();
    const base = createFakeClient('practice-my-turn');
    const empty = { ...base.getSnapshot(), view: null };
    const client: FakeClient = { ...base, getSnapshot: () => empty };
    setup('practice-my-turn', client);
    const loading = screen.getByTestId('T-01.loading');
    expect(loading.querySelector('[data-testid="T-01.felt"]')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(loading.querySelector('[data-testid="T-01.felt"]')).toBeTruthy();
  });

  it('Leave outside a live hand leaves at once; inside one asks first with Stay focused', async () => {
    const paused = setup('practice-paused');
    fireEvent.click(screen.getByTestId('T-01.leave'));
    expect(paused.onLeave).toHaveBeenCalledTimes(1);
    cleanup();
    const live = setup('practice-my-turn');
    fireEvent.click(screen.getByTestId('T-01.leave'));
    expect(await screen.findByTestId('T-01.leaveDialog')).toBeTruthy();
    expect(live.onLeave).not.toHaveBeenCalled();
    expect(screen.getByText('Leave the table?')).toBeTruthy();
  });
});

/** A practice-my-turn client where the turn has passed to someone else (I am still in the hand). */
function waitingInHandClient(): FakeClient {
  const base = createFakeClient('practice-my-turn');
  const snap = base.getSnapshot();
  const v = snap.view!;
  const other = v.seats.find((x) => x.occupant !== null && !x.occupant.isMe)!.seat;
  const next = { ...snap, view: { ...v, me: { ...v.me, legal: null }, hand: { ...v.hand!, toAct: other } } };
  return { ...base, getSnapshot: () => next };
}

/** The `refill` scenario after its offer lapsed: still sitting out at 0 chips, no refill on offer. */
function missedClient(): FakeClient {
  const base = createFakeClient('refill');
  const snap = base.getSnapshot();
  const next = { ...snap, view: { ...snap.view!, me: { ...snap.view!.me, canRefill: false } } };
  return { ...base, getSnapshot: () => next };
}

describe('bottom slot and felt centre (W5 R0-2 R0-L19, MS-R0-3 D4 / O1 / O2)', () => {
  it.each([
    ['practice-my-turn', 'act', 'T-01.actionBar'],
    ['waiting-in-hand', 'pre', 'T-01.preAction'],
    ['showdown', 'next', 'T-01.countdown'],
    ['practice-paused', 'next', 'T-01.pausedPill'],
    ['refill', 'next', 'T-06.card'],
    ['practice-busted', 'next', 'T-06.card'],
    ['sitting-out', 'next', 'T-01.sitOut'],
    ['missed', 'next', 'T-06.missed'],
    ['waiting', 'empty', null],
  ] as const)('%s -> slot mode %s with %s inside it', (scenario, mode, inside) => {
    const client =
      scenario === 'waiting-in-hand' ? waitingInHandClient() : scenario === 'missed' ? missedClient() : scenario === 'sitting-out' ? sittingOutClient() : undefined;
    setup(scenario === 'waiting-in-hand' ? 'practice-my-turn' : scenario === 'missed' ? 'refill' : scenario, client);
    const slot = screen.getByTestId('T-01.slot');
    expect(slot.dataset.mode).toBe(mode);
    if (inside === null) expect(slot.textContent).toBe('');
    else expect(within(slot).getByTestId(inside)).toBeTruthy();
  });

  // D4: nothing pressable may sit on the felt, where the board cards drew over the pill's button.
  it.each(['showdown', 'practice-paused', 'practice-busted', 'refill', 'sitting-out'])('%s: no button on the felt; the next-step buttons are in the slot', (scenario) => {
    setup(scenario, scenario === 'sitting-out' ? sittingOutClient() : undefined);
    expect(screen.getByTestId('T-01.felt').querySelectorAll('button')).toHaveLength(0);
    expect(within(screen.getByTestId('T-01.slot')).getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('a card replaces the pill (no second Resume/Pause next to it) and carries its words: "Next hand in 5" in the refill window', () => {
    setup('refill');
    expect(screen.queryByTestId('T-01.countdown')).toBeNull();
    expect(screen.getByTestId('T-06.card').textContent).toContain('Next hand in 5');
  });

  // O2: between hands the pot is already shared out — no leftover "POT" for revealed top-seat badges to run into.
  it('the pot shows on the felt while the hand is played and not between hands or paused', () => {
    setup('practice-my-turn');
    expect(within(screen.getByTestId('T-01.felt')).getByTestId('T-01.pot').textContent).toMatch(/^Pot/i);
    cleanup();
    setup('showdown');
    expect(screen.queryByTestId('T-01.pot')).toBeNull();
    cleanup();
    setup('practice-paused');
    expect(screen.queryByTestId('T-01.pot')).toBeNull();
  });

  it('pot and board are one felt-centre box: the pot hangs off the board top, the board is anchored at (50 %, 56 %)', () => {
    setup('practice-my-turn');
    const board = screen.getByTestId('T-01.board');
    const centre = board.parentElement!;
    expect(centre.style.left).toBe('50%');
    expect(centre.style.top).toBe('56%');
    expect(centre.contains(screen.getByTestId('T-01.pot'))).toBe(true);
  });
});

describe('table toasts sit above the bottom slot and never take a click (R0-L18, MS-R0-3 D5)', () => {
  /** A ResizeObserver stand-in that records its callback so a test can report a new size. */
  function stubResizeObserver() {
    const observers: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly cb: () => void) {
          observers.push(() => this.cb());
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    return { fire: () => observers.forEach((o) => o()) };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('--toast-bottom = slot height + 16 px, follows the slot (an opened BetSizer) and is removed with the table', () => {
    const ro = stubResizeObserver();
    let height = 112;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.dataset.testid === 'T-01.slot' ? height : 0 } as DOMRect;
    });
    const root = document.documentElement;
    const { unmount } = renderI18n(<TableScreen client={createFakeClient('practice-my-turn')} computeMetrics={undefined} liveOdds={false} onLiveOdds={vi.fn()} onLeave={vi.fn()} onRestart={vi.fn()} />);
    expect(root.style.getPropertyValue('--toast-bottom')).toBe('calc(112px + var(--s-4))');
    expect(root.dataset.tableToasts).toBe('');
    fireEvent.click(screen.getByTestId('T-01.raise'));
    height = 236; // the BetSizer opened inside the slot
    act(() => ro.fire());
    expect(root.style.getPropertyValue('--toast-bottom')).toBe('calc(236px + var(--s-4))');
    unmount();
    expect(root.style.getPropertyValue('--toast-bottom')).toBe('');
    expect(root.dataset.tableToasts).toBeUndefined();
  });

  it('the Toaster offsets by --toast-bottom (24 px + safe area off the table), and table toasts are click-through', () => {
    const toast = readRepoFile('frontend/src/app/ui/Toast.tsx');
    expect(toast).toContain("const BOTTOM = 'var(--toast-bottom, calc(var(--s-6) + env(safe-area-inset-bottom)))';");
    expect(toast).toMatch(/offset=\{\{ bottom: BOTTOM \}\}/);
    expect(toast).toMatch(/mobileOffset=\{\{ bottom: BOTTOM \}\}/);
    const theme = readRepoFile('frontend/src/styles/theme.css').replace(/\s+/g, ' ');
    expect(theme).toContain(':root[data-table-toasts] [data-sonner-toaster], :root[data-table-toasts] [data-sonner-toast] { pointer-events: none; }');
  });
});

// D-R3-2 (MS-R0-3 run 3): below 768 the sheet covers the action bar, so a row that left it open ran my turn clock out
// behind it (Keep playing did). Every state row acts once and closes the sheet, and focus goes back to the menu
// button that opened it (components.md 1.8) instead of <body>.
describe('menu state rows close the sheet (T-05, lead review 4 D-R3-2)', () => {
  /** Opens the menu the way a keyboard user does: focus on the menu button, then press it. */
  async function openMenu() {
    const menu = screen.getByTestId('T-01.menu');
    menu.focus();
    fireEvent.click(menu);
    return { menu, sheet: await screen.findByTestId('T-05.sheet') };
  }

  it.each([
    ['practice-my-turn', 'T-05.pause', 'pause'],
    ['practice-pausing', 'T-05.keepPlaying', 'resume'],
    ['practice-paused', 'T-05.resume', 'resume'],
    ['practice-busted', 'T-05.refill', 'refill'],
  ] as const)('%s: %s -> %s() once, the sheet is gone and focus is back on the menu button', async (scenario, row, method) => {
    const { count } = setup(scenario);
    const { menu, sheet } = await openMenu();
    expect(document.activeElement).not.toBe(menu); // focus moved into the sheet
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId(row));
    });
    expect(count(method)).toBe(1);
    expect(screen.queryByTestId('T-05.sheet')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(menu));
  });

  it('Esc and the close button also give focus back to the menu button', async () => {
    setup('practice-my-turn');
    for (const close of [(sheet: HTMLElement) => fireEvent.keyDown(sheet, { key: 'Escape' }), (sheet: HTMLElement) => fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }))]) {
      const { menu, sheet } = await openMenu();
      await act(async () => close(sheet));
      expect(screen.queryByTestId('T-05.sheet')).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(menu));
    }
  });

  it('Leave table during a hand: the sheet is gone, the Leave confirmation asks and keeps focus on Stay', async () => {
    const { onLeave } = setup('practice-my-turn');
    const { menu, sheet } = await openMenu();
    const menuFocused = vi.fn();
    menu.addEventListener('focus', menuFocused);
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId('T-05.leave'));
    });
    expect(screen.queryByTestId('T-05.sheet')).toBeNull();
    expect(await screen.findByTestId('T-01.leaveDialog')).toBeTruthy();
    await act(async () => new Promise((r) => setTimeout(r, 20))); // the sheet's close-focus step has run
    expect(document.activeElement?.textContent).toBe('Stay');
    expect(menuFocused).not.toHaveBeenCalled(); // not even for a moment (a screen reader would read it)
    expect(onLeave).not.toHaveBeenCalled();
  });

  it('pause pending: the sheet says "Pausing before the next hand" next to Keep playing', async () => {
    setup('practice-pausing');
    fireEvent.click(screen.getByTestId('T-01.menu'));
    const sheet = await screen.findByTestId('T-05.sheet');
    expect(within(sheet).getByText('Pausing before the next hand')).toBeTruthy();
    expect(within(sheet).getByTestId('T-05.keepPlaying').textContent).toBe('Keep playing');
  });
});

describe('menu Pause row and the refill window (T-05, R0-L25)', () => {
  it('between hands with a refill on offer: the row is plain "Pause" (it stops at once) and there is no refill row', async () => {
    setup('refill');
    fireEvent.click(screen.getByTestId('T-01.menu'));
    const sheet = await screen.findByTestId('T-05.sheet');
    expect(within(sheet).getByTestId('T-05.pause').textContent).toBe('Pause');
    expect(within(sheet).queryByTestId('T-05.refill')).toBeNull();
  });
});

// R0-L28 (MS-R0-3 run 2 D-R2-3). Layout is measured in real Chrome (frontend.md §16.2); what a unit test can
// hold is the contract that measurement relies on: the scroll column never centres with justify-content (what it
// pushed out at the top could not be scrolled to), it centres with auto margins instead, and the room above and below
// the felt follows whether a seat block shows its cards (the blocks are taller then).
describe('table column: safe centring and room for the seat blocks (R0-L28)', () => {
  const shows = (scenario: string) => fakeView(scenario).seats.some((s) => (s.occupant?.inHand?.cards ?? null) !== null);

  it('the fixtures cover both states', () => {
    expect(['practice-my-turn', 'showdown', 'bot-reveal', 'practice-paused'].map(shows)).toContain(true);
    expect(['practice-my-turn', 'showdown', 'bot-reveal', 'practice-paused'].map(shows)).toContain(false);
  });

  it.each(['practice-my-turn', 'showdown', 'bot-reveal', 'practice-paused'])('%s: auto-margin centring, room per seat-card state', (scenario) => {
    setup(scenario);
    const column = screen.getByTestId('T-01.scroll');
    const [feltRow, heroRow] = [...column.children] as HTMLElement[];
    expect(column.className).not.toMatch(/\bjustify-center\b/);
    expect(column.className).toContain('overflow-y-auto');
    expect(feltRow!.className).toContain('mt-auto');
    expect(heroRow!.className).toContain('mb-auto');
    const cards = shows(scenario);
    expect(column.dataset.seatCards).toBe(String(cards));
    // During a hand: 60 / 80 px above, 96 / 72 below (B / A); with cards shown: 88 / 112 above, 96 below.
    expect(column.className.split(' ').filter((c) => /^(md:)?pt-\d+$/.test(c))).toEqual(cards ? ['pt-22', 'md:pt-28'] : ['pt-15', 'md:pt-20']);
    expect(feltRow!.className.split(' ').filter((c) => /^(md:)?pb-\d+$/.test(c))).toEqual(cards ? ['pb-24'] : ['pb-24', 'md:pb-18']);
  });
});

// D-R3-1 (MS-R0-3 run 3). The geometry is measured in real Chrome (frontend.md §17.2); this recomputes the side room
// from layout.ts, so moving a seat point or changing the block width or the column padding without the room fails.
describe('table column: side room for the side seat blocks (D-R3-1)', () => {
  const COLUMN_PX = 16; // the scroll column's px-4
  const SPACING_PX = 4; // --spacing = --s-1
  /** Felt-row padding a side per layout, read from its classes (md:px-N wins from 768). */
  function room(className: string): { a: number; b: number } {
    const px = (re: RegExp) => {
      const m = re.exec(className);
      return m ? Number(m[1]) * SPACING_PX : null;
    };
    const b = px(/(?:^|\s)px-(\d+)(?:\s|$)/) ?? 0;
    return { a: px(/(?:^|\s)md:px-(\d+)(?:\s|$)/) ?? b, b };
  }
  /** How far the side block closest to a felt side reaches past it: half a block minus the point's inset. */
  const reach = (points: readonly Point[], halfBlock: number, feltW: number) => halfBlock - (Math.min(...points.map((p) => Math.min(p.x, 100 - p.x))) / 100) * feltW;
  // The narrowest width of each layout where the felt fills the column, from the lead's widths (360 ... 1920): A at
  // 768, also minus a classic vertical scrollbar (17 px) for when the column overflows; B at 360.
  const LAYOUTS = [
    { layout: 'a', halfBlock: 56, narrowest: 768 - 17, measured: 768, points: (n: number) => LAYOUT_A[n]! },
    { layout: 'b', halfBlock: 48, narrowest: 360, measured: 360, points: (n: number) => Array.from({ length: n }, (_, i) => seatPointB(i, n)) },
  ] as const;

  it.each([2, 3, 4, 5, 6])('%i seats: side room only where a side block would pass the column, and enough of it', (count) => {
    renderI18n(<TableLayout hud={null} felt={null} hero={null} actionBar={null} seatCards={false} seatCount={count} />);
    const extra = room(screen.getByTestId('T-01.feltRow').className);
    for (const { layout, halfBlock, narrowest, measured, points } of LAYOUTS) {
      const side = COLUMN_PX + extra[layout];
      const fits = reach(points(count), halfBlock, narrowest - 2 * side) <= side;
      const needed = reach(points(count), halfBlock, measured - 2 * COLUMN_PX) > COLUMN_PX;
      expect({ layout, fits, extraOnlyIfNeeded: extra[layout] === 0 || needed }).toEqual({ layout, fits: true, extraOnlyIfNeeded: true });
    }
  });

  it('TableScreen passes its seat count (practice-my-turn)', () => {
    setup('practice-my-turn');
    const fromScreen = screen.getByTestId('T-01.feltRow').className;
    cleanup();
    renderI18n(<TableLayout hud={null} felt={null} hero={null} actionBar={null} seatCards={false} seatCount={fakeView('practice-my-turn').seats.length} />);
    expect(fromScreen).toBe(screen.getByTestId('T-01.feltRow').className);
    expect(room(fromScreen)).not.toEqual({ a: 0, b: 0 }); // the fixture is a table that needs room (4 seats)
  });
});

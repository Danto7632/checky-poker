// RefillPrompt (US3 AC1-AC5, G-1/G-4): free and unlimited, no counter, no purchase words. The card and the
// "You have N chips." confirmation live in the bottom slot (W5 R0-2); the confirmation follows the snapshots, so a
// refill from the menu row confirms the same way as one from the card.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerView } from '@checky/engine/protocol';
import { fakeView, renderWithActions } from '../testing/table-fixtures';
import { BottomSlot } from './BottomSlot';
import { RefillPrompt } from './RefillPrompt';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const slot = (view: PlayerView) => <BottomSlot view={view} notices={[]} act={null} pre={null} />;
const refilled = (v: PlayerView): PlayerView => ({
  ...v,
  me: { ...v.me, canRefill: false, status: 'ACTIVE' },
  seats: v.seats.map((s) => (s.occupant?.isMe ? { ...s, occupant: { ...s.occupant, stack: 10000, status: 'ACTIVE' } } : s)),
});

describe('RefillPrompt', () => {
  it('canRefill: card with the "as many times as you like" sentence; the button calls refill()', () => {
    const { actions } = renderWithActions(<RefillPrompt view={fakeView('refill')} />);
    const card = screen.getByTestId('T-06.card');
    expect(card.textContent).toContain('Out of chips');
    expect(card.textContent).toContain('Get 10,000 chips again — free, as many times as you like.');
    fireEvent.click(screen.getByTestId('T-06.refill'));
    expect(actions.refill).toHaveBeenCalledTimes(1);
    expect(card.textContent).not.toMatch(/\b(buy|top up|get more chips|free coins)\b/i);
  });

  it('after pressing, the slot shows "You have N chips." in the card\'s place for 1.5 s, then the pill', async () => {
    vi.useFakeTimers();
    const v = fakeView('refill');
    const { rerender } = renderWithActions(slot(v));
    fireEvent.click(screen.getByTestId('T-06.refill'));
    await act(async () => {
      rerender(slot(refilled(v)));
    });
    expect(screen.getByTestId('T-06.done').textContent).toBe('You have 10,000 chips.');
    expect(screen.queryByTestId('T-06.card')).toBeNull();
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.queryByTestId('T-06.done')).toBeNull();
    expect(screen.getByTestId('T-01.countdown')).toBeTruthy();
  });

  it('a refill from elsewhere (the menu row — R0-L3) shows the same "You have N chips."', async () => {
    const v = fakeView('practice-busted');
    const { rerender, actions } = renderWithActions(slot(v));
    await act(async () => {
      rerender(slot(refilled(v)));
    });
    expect(actions.refill).not.toHaveBeenCalled();
    expect(screen.getByTestId('T-06.done').textContent).toBe('You have 10,000 chips.');
  });

  it('a stack that changes while no refill was on offer is not a refill (no confirmation)', async () => {
    const v = fakeView('practice-paused');
    const { rerender } = renderWithActions(slot(v));
    const more: PlayerView = { ...v, seats: v.seats.map((s) => (s.occupant?.isMe ? { ...s, occupant: { ...s.occupant, stack: s.occupant.stack + 500 } } : s)) };
    await act(async () => {
      rerender(slot(more));
    });
    expect(screen.queryByTestId('T-06.done')).toBeNull();
  });

  it('sitting out with 0 chips and no refill offer: "sitting out until you get chips"', () => {
    const v = fakeView('refill');
    const missed: PlayerView = { ...v, me: { ...v.me, canRefill: false, status: 'SITTING_OUT' } };
    renderWithActions(slot(missed));
    expect(screen.getByTestId('T-06.missed').textContent).toBe("You're sitting out until you get chips.");
  });
});

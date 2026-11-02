// The bottom slot's `next` pill (ui-spec T-01 pause table, US7 AC5): PAUSED with fewer than two seated players
// holding chips says "Waiting for players" (no Resume); otherwise "Paused" + Resume. Its only buttons are Pause and
// Resume (R0-L25) — never a refill button, even when paused on my empty stack (the slot shows the T-06 card then).
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '@checky/engine/protocol';
import { fakeView, renderWithActions } from '../testing/table-fixtures';
import { BetweenHandsCountdown, NextStatus, seatedWithChips } from './BetweenHandsCountdown';

afterEach(cleanup);

describe('BetweenHandsCountdown', () => {
  it('PAUSED with < 2 seated players holding chips -> "Waiting for players"', () => {
    const v = fakeView('practice-paused');
    const broke: PlayerView = { ...v, seats: v.seats.map((s) => (s.occupant && !s.occupant.isMe ? { ...s, occupant: { ...s.occupant, stack: 0 } } : s)) };
    expect(seatedWithChips(broke)).toBe(1);
    renderWithActions(<BetweenHandsCountdown view={broke} />);
    expect(screen.getByTestId('T-01.pausedPill').textContent).toBe('Waiting for players');
    expect(screen.queryByTestId('T-01.resumePill')).toBeNull();
  });

  it('PAUSED with players -> "Paused" + Resume', () => {
    renderWithActions(<BetweenHandsCountdown view={fakeView('practice-paused')} />);
    expect(screen.getByTestId('T-01.pausedPill').textContent).toContain('Paused');
    expect(screen.getByTestId('T-01.resumePill')).toBeTruthy();
  });

  it('in a hand with no pause -> nothing', () => {
    const { container } = renderWithActions(<BetweenHandsCountdown view={fakeView('practice-my-turn')} />);
    expect(container.firstChild).toBeNull();
  });

  it('paused on my empty stack: no "Get chips again" in the pill (R0-L25 — that is the T-06 card\'s)', () => {
    renderWithActions(<BetweenHandsCountdown view={fakeView('practice-busted')} />);
    expect(screen.queryByRole('button', { name: 'Get chips again' })).toBeNull();
    expect(screen.queryByTestId('T-01.refillPill')).toBeNull();
  });

  it('NextStatus: the pill\'s words for a card — "Next hand in 5" between hands, "Paused" when stopped, none in a hand', () => {
    const { rerender } = renderWithActions(<NextStatus view={fakeView('refill')} />);
    expect(document.body.textContent).toBe('Next hand in 5');
    rerender(<NextStatus view={fakeView('practice-busted')} />);
    expect(document.body.textContent).toBe('Paused');
    rerender(<NextStatus view={fakeView('practice-my-turn')} />);
    expect(document.body.textContent).toBe('');
  });
});

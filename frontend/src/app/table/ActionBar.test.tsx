// ActionBar (components.md 3.8, US8, SS9): only legal actions, equal-weight buttons, NACK inline banner, keyboard,
// "Your turn" without seconds when turn === null.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalActions } from '@checky/engine/protocol';
import type { Ack } from '@/session';
import { renderI18n } from '../testing/render';
import { ActionBar, type ActionBarProps } from './ActionBar';

afterEach(cleanup);

const FACING: LegalActions = { fold: true, check: false, call: { amount: 400, to: 400 }, bet: null, raise: { minTo: 800, maxTo: 9700 }, allIn: { to: 9700 }, reopened: true };
const OPEN: LegalActions = { fold: true, check: true, call: null, bet: { min: 100, max: 9400 }, raise: null, allIn: { to: 9400 }, reopened: true };
// Engine shapes after the R0 M2 fix (hand/legal.ts): closed raising caps allIn.to at the call (or at my bet).
const CLOSED: LegalActions = { fold: true, check: false, call: { amount: 200, to: 600 }, bet: null, raise: null, allIn: { to: 600 }, reopened: false };
const CLOSED_CHECK: LegalActions = { fold: true, check: true, call: null, bet: null, raise: null, allIn: { to: 300 }, reopened: false };
// Open raising but the stack is below a full raise: all-in is an under-raise, more than the call.
const SHORT: LegalActions = { fold: true, check: false, call: { amount: 200, to: 600 }, bet: null, raise: null, allIn: { to: 900 }, reopened: true };

function setup(legal: LegalActions, over: Partial<ActionBarProps> = {}, ack: Ack = { ok: true }) {
  const onAct = vi.fn(() => Promise.resolve(ack));
  renderI18n(<ActionBar legal={legal} seat={0} pot={1500} myBet={0} bb={100} turn={{ remainingMs: 24000, totalMs: 30000 }} turnKey="h:1" shortcuts onAct={onAct} {...over} />);
  return onAct;
}

describe('ActionBar', () => {
  it('facing a bet: Fold · Call 400 · Raise… only, all secondary', () => {
    setup(FACING);
    expect(screen.getByTestId('T-01.fold')).toBeTruthy();
    expect(screen.getByTestId('T-01.call').textContent).toContain('Call 400');
    expect(screen.getByTestId('T-01.raise')).toBeTruthy();
    expect(screen.queryByTestId('T-01.check')).toBeNull();
    expect(screen.queryByTestId('T-01.bet')).toBeNull();
    for (const id of ['T-01.fold', 'T-01.call', 'T-01.raise']) expect(screen.getByTestId(id).className).toContain('bg-input');
    expect(screen.getByText(/To call 400/)).toBeTruthy();
  });

  it('nothing to call: Fold · Check · Bet…', () => {
    setup(OPEN);
    expect(screen.getByTestId('T-01.check')).toBeTruthy();
    expect(screen.getByTestId('T-01.bet')).toBeTruthy();
    expect(screen.queryByTestId('T-01.call')).toBeNull();
  });

  it('reopened = false: Fold · Call only — All-in capped at the call is not a second button (B-E6, R0 M2)', () => {
    setup(CLOSED, { myBet: 400 });
    expect(screen.queryByTestId('T-01.raise')).toBeNull();
    expect(screen.queryByTestId('T-01.allIn')).toBeNull();
    expect(screen.getByTestId('T-01.call').textContent).toContain('Call 200');
  });

  it('reopened = false with nothing to call: Fold · Check, never "All-in" for my current bet (R0 M2)', () => {
    setup(CLOSED_CHECK, { myBet: 300 });
    expect(screen.getByTestId('T-01.check')).toBeTruthy();
    expect(screen.queryByTestId('T-01.allIn')).toBeNull();
    expect(screen.queryByTestId('T-01.bet')).toBeNull();
  });

  it('short stack below a full raise: All-in to more than the call has its own button (R0 M2)', async () => {
    const onAct = setup(SHORT, { myBet: 400 });
    expect(screen.queryByTestId('T-01.raise')).toBeNull();
    const allIn = screen.getByTestId('T-01.allIn');
    expect(allIn.textContent).toContain('All-in 900');
    await act(async () => {
      fireEvent.click(allIn);
    });
    expect(onAct).toHaveBeenCalledWith({ seat: 0, type: 'allin', to: 900 });
  });

  it('a rejected act() promise releases the buttons instead of blocking the turn (review m9)', async () => {
    const onAct = vi.fn(() => Promise.reject(new Error('worker gone')));
    renderI18n(<ActionBar legal={FACING} seat={0} pot={1500} myBet={0} bb={100} turn={null} turnKey="h:1" shortcuts onAct={onAct} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('T-01.call'));
    });
    expect(onAct).toHaveBeenCalledTimes(1);
    for (const id of ['T-01.fold', 'T-01.call', 'T-01.raise']) expect(screen.getByTestId(id).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByTestId('T-01.actError')).toBeNull();
  });

  it('a rejected act shows the inline banner and keeps the bar (US8 AC3)', async () => {
    const onAct = setup(FACING, {}, { ok: false, code: 'E-ACT-NOT-YOUR-TURN' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('T-01.call'));
    });
    expect(onAct).toHaveBeenCalledWith({ seat: 0, type: 'call' });
    expect(screen.getByTestId('T-01.actError').textContent).toContain("It's not your turn.");
    expect(screen.getByTestId('T-01.fold')).toBeTruthy();
  });

  it('E-ACT-STALE stays silent', async () => {
    setup(FACING, {}, { ok: false, code: 'E-ACT-STALE' });
    await act(async () => {
      fireEvent.click(screen.getByTestId('T-01.fold'));
    });
    expect(screen.queryByTestId('T-01.actError')).toBeNull();
  });

  it('keyboard F folds, C calls; ignored while typing; off when shortcuts are off', async () => {
    const onAct = setup(FACING);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'f' });
    });
    expect(onAct).toHaveBeenLastCalledWith({ seat: 0, type: 'fold' });
    cleanup();
    const onAct2 = setup(FACING, { shortcuts: false });
    fireEvent.keyDown(window, { key: 'c' });
    expect(onAct2).not.toHaveBeenCalled();
    cleanup();
    const onAct3 = setup(FACING);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'c' });
    expect(onAct3).not.toHaveBeenCalled();
    input.remove();
  });

  it('turn === null shows "Your turn" with no seconds (practice No limit)', () => {
    setup(FACING, { turn: null });
    const label = screen.getByText('Your turn');
    expect(label.textContent).toBe('Your turn');
    expect(screen.queryByText(/\d+s/)).toBeNull();
  });

  it('with a clock shows "Your turn · 24s"', () => {
    setup(FACING);
    expect(screen.getByText('Your turn').textContent).toBe('Your turn · 24s');
  });
});

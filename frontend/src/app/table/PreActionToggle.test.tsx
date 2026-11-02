// PreActionToggle (SS9 rule 4, US8 AC5): one toggle, check if possible otherwise fold, once, reset every hand.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalActions } from '@checky/engine/protocol';
import { checkOrFold, usePreAction } from './PreActionToggle';

afterEach(cleanup);

const CHECKABLE: LegalActions = { fold: true, check: true, call: null, bet: { min: 100, max: 500 }, raise: null, allIn: { to: 500 }, reopened: true };
const FACING: LegalActions = { fold: true, check: false, call: { amount: 100, to: 100 }, bet: null, raise: null, allIn: { to: 500 }, reopened: true };

describe('Check/Fold pre-action', () => {
  it('checkOrFold picks check when legal, fold otherwise', () => {
    expect(checkOrFold(CHECKABLE, 1)).toEqual({ seat: 1, type: 'check' });
    expect(checkOrFold(FACING, 1)).toEqual({ seat: 1, type: 'fold' });
  });

  it('fires once when my turn arrives, then switches itself off', () => {
    const onAct = vi.fn();
    const { result, rerender } = renderHook((p: { legal: LegalActions | null; turnKey: string }) => usePreAction({ handId: 'h1', seat: 1, onAct, ...p }), {
      initialProps: { legal: null as LegalActions | null, turnKey: 'h1:3' },
    });
    act(() => result.current[1](true));
    expect(onAct).not.toHaveBeenCalled();
    rerender({ legal: FACING, turnKey: 'h1:4' });
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct).toHaveBeenCalledWith({ seat: 1, type: 'fold' });
    expect(result.current[0]).toBe(false);
    rerender({ legal: FACING, turnKey: 'h1:4' });
    expect(onAct).toHaveBeenCalledTimes(1);
  });

  it('resets to off on a new hand', () => {
    const onAct = vi.fn();
    const { result, rerender } = renderHook((p: { handId: string }) => usePreAction({ legal: null, turnKey: 'k', seat: 0, onAct, ...p }), { initialProps: { handId: 'h1' } });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    rerender({ handId: 'h2' });
    expect(result.current[0]).toBe(false);
  });
});

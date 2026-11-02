// US9 AC2: my own timeout produces exactly one toast with the right sentence; other seats' timeouts do not.
import { cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionLogEntry, PlayerView } from '@checky/engine/protocol';
import { I18nProvider } from '../i18n/useT';
import { fakeView } from '../testing/table-fixtures';
import { useTimeoutToast } from './useTimeoutToast';

afterEach(cleanup);

const base = fakeView('practice-my-turn');
const withActions = (extra: ActionLogEntry[]): PlayerView => ({ ...base, hand: { ...base.hand!, actions: [...base.hand!.actions, ...extra] } });
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider lang="en">{children}</I18nProvider>;

describe('useTimeoutToast', () => {
  it('toasts once when my seat times out (fold), not for other seats, not again on re-render', () => {
    const notify = vi.fn();
    const { rerender } = renderHook((v: PlayerView) => useTimeoutToast(v, notify), { initialProps: base, wrapper });
    rerender(withActions([{ i: 9, street: 'PREFLOP', seat: 3, type: 'fold', to: 0, added: 0, auto: 'timeout' }]));
    expect(notify).not.toHaveBeenCalled();
    const mine = withActions([{ i: 10, street: 'PREFLOP', seat: 0, type: 'fold', to: 0, added: 0, auto: 'timeout' }]);
    rerender(mine);
    rerender({ ...mine });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Time ran out — you folded.');
  });

  it('a timeout check says "you checked"', () => {
    const notify = vi.fn();
    const { rerender } = renderHook((v: PlayerView) => useTimeoutToast(v, notify), { initialProps: base, wrapper });
    rerender(withActions([{ i: 10, street: 'FLOP', seat: 0, type: 'check', to: 0, added: 0, auto: 'timeout' }]));
    expect(notify).toHaveBeenCalledWith('Time ran out — you checked.');
  });
});

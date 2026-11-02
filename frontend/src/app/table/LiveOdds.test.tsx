// LiveOdds (US20 AC1/AC3, SC4, ui-spec 0.5 rule 9): one computation per new turn of mine, none when off, stale
// results dropped, and the three SC4 render cases in en and ja.
import { act, cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DecisionMetrics } from '@checky/analysis';
import type { PlayerView } from '@checky/engine/protocol';
import { fakeView } from '../testing/table-fixtures';
import { renderI18n } from '../testing/render';
import { LiveOdds } from './LiveOdds';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const metrics = (equity: Partial<DecisionMetrics['equity']>, potOdds: DecisionMetrics['potOdds'] = { pot: 6000, call: 2400 }): DecisionMetrics => ({
  equity: { value: 0.412, method: 'exact', samples: null, halfWidth95: null, opponents: 2, ...equity },
  potOdds,
  requiredEquity: potOdds ? 0.286 : null,
  effectiveStack: 9000,
  spr: null,
  position: { label: 'BTN', inPosition: true },
  verdict: null,
  basis: 'vs_random_hands',
});

const myTurn = fakeView('practice-my-turn');
const withTurn = (v: PlayerView, turnSeq: number, turnMs: number | null = 52000): PlayerView => ({ ...v, hand: { ...v.hand!, turnSeq, turnMs } });

async function renderOdds(m: DecisionMetrics, lang: 'en' | 'ja' = 'en') {
  const compute = vi.fn(() => Promise.resolve(m));
  renderI18n(<LiveOdds view={myTurn} compute={compute} enabled />, lang);
  await screen.findByTestId('T-01.liveOdds');
  await act(async () => undefined);
  return screen.getByTestId('T-01.liveOdds');
}

describe('LiveOdds call count', () => {
  it('on: one call per new turn; clock-only updates do not recompute', async () => {
    const compute = vi.fn(() => Promise.resolve(metrics({})));
    const { rerender } = renderI18n(<LiveOdds view={myTurn} compute={compute} enabled />);
    await act(async () => undefined);
    expect(compute).toHaveBeenCalledTimes(1);
    rerender(<LiveOdds view={withTurn(myTurn, myTurn.hand!.turnSeq, 41000)} compute={compute} enabled />);
    await act(async () => undefined);
    expect(compute).toHaveBeenCalledTimes(1);
    rerender(<LiveOdds view={withTurn(myTurn, myTurn.hand!.turnSeq + 2)} compute={compute} enabled />);
    await act(async () => undefined);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('off: zero calls and nothing rendered', async () => {
    const compute = vi.fn(() => Promise.resolve(metrics({})));
    const { container } = renderI18n(<LiveOdds view={myTurn} compute={compute} enabled={false} />);
    await act(async () => undefined);
    expect(compute).not.toHaveBeenCalled();
    expect(container.firstChild).toBeNull();
  });

  it('not my turn: zero calls', async () => {
    const compute = vi.fn(() => Promise.resolve(metrics({})));
    renderI18n(<LiveOdds view={fakeView('practice-paused')} compute={compute} enabled />);
    await act(async () => undefined);
    expect(compute).not.toHaveBeenCalled();
  });

  it('drops a late result from an older turn', async () => {
    let resolveOld: (m: DecisionMetrics) => void = () => undefined;
    const compute = vi
      .fn<(v: unknown) => Promise<DecisionMetrics>>()
      .mockImplementationOnce(() => new Promise((r) => (resolveOld = r)))
      .mockImplementationOnce(() => Promise.resolve(metrics({ value: 0.75 })));
    const { rerender } = renderI18n(<LiveOdds view={myTurn} compute={compute} enabled />);
    rerender(<LiveOdds view={withTurn(myTurn, 9)} compute={compute} enabled />);
    await act(async () => undefined);
    await act(async () => resolveOld(metrics({ value: 0.1 })));
    expect(screen.getByTestId('T-01.liveOdds').textContent).toContain('75.0%');
    expect(screen.getByTestId('T-01.liveOdds').textContent).not.toContain('10.0%');
  });

  it('shows "—" after 300 ms while computing, and hides on failure', async () => {
    vi.useFakeTimers();
    const compute = vi.fn(() => new Promise<DecisionMetrics>(() => undefined));
    const { rerender } = renderI18n(<LiveOdds view={myTurn} compute={compute} enabled />);
    expect(screen.queryByTestId('T-01.liveOdds')).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('T-01.liveOdds').textContent).toContain('—');
    vi.useRealTimers();
    const failing = vi.fn(() => Promise.reject(new Error('E-ANL-SLOW')));
    rerender(<LiveOdds view={withTurn(myTurn, 7)} compute={failing} enabled />);
    await act(async () => undefined);
    expect(screen.queryByTestId('T-01.liveOdds')).toBeNull();
  });
});

describe('LiveOdds and a replaced request (AbortError, Stephen D-ML-9)', () => {
  it('an AbortError is not a failure: the panel stays and keeps waiting ("—"), unlike any other rejection', async () => {
    vi.useFakeTimers();
    const aborted = vi.fn(() => Promise.reject(new DOMException('replaced by a newer request', 'AbortError')));
    renderI18n(<LiveOdds view={myTurn} compute={aborted} enabled />);
    await act(async () => undefined);
    act(() => vi.advanceTimersByTime(300));
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('T-01.liveOdds').textContent).toContain('—');
  });
});

describe('SC4 render cases (ui-spec 0.5 rule 9)', () => {
  it('mc with half-width (en): "≈24.1%" + "Estimate ±2.4%" + hidden odds.sr.mc', async () => {
    const panel = await renderOdds(metrics({ method: 'mc', value: 0.241, halfWidth95: 0.0237, samples: 10000 }));
    expect(panel.textContent).toContain('≈24.1%');
    expect(panel.textContent).toContain('Estimate ±2.4%');
    expect(panel.querySelector('.sr-only')?.textContent).toBe('about 24.1 percent, estimate, usually within 2.4 points');
    expect(screen.getByTestId('T-01.oddsBadge').getAttribute('aria-hidden')).toBe('true');
  });

  it('exact (en): no "≈", no badge text at all, hidden odds.sr.exact', async () => {
    const panel = await renderOdds(metrics({ method: 'exact', value: 0.412 }));
    expect(panel.textContent).toContain('41.2%');
    expect(panel.textContent).not.toContain('≈');
    expect(panel.textContent).not.toMatch(/Exact|Estimate/);
    expect(screen.queryByTestId('T-01.oddsBadge')).toBeNull();
    expect(panel.querySelector('.sr-only')?.textContent).toBe('41.2 percent, exact');
    expect(panel.textContent).toContain('2.5 : 1');
    expect(panel.textContent).toContain('28.6%');
    expect(panel.textContent).toContain('vs 2 random hands');
  });

  it('mc without half-width (en): "Estimate" without ±, odds.sr.mcNoHw', async () => {
    const panel = await renderOdds(metrics({ method: 'mc', value: 0.5, halfWidth95: null, samples: null }));
    expect(screen.getByTestId('T-01.oddsBadge').textContent).toBe('Estimate');
    expect(panel.textContent).not.toContain('±');
    expect(panel.querySelector('.sr-only')?.textContent).toBe('about 50.0 percent, estimate');
  });

  it.each([
    [{ method: 'mc' as const, value: 0.241, halfWidth95: 0.0237, samples: 10000 }, ['≈24.1%', '推定 ±2.4%'], '約24.1パーセント、推定値、誤差はおおむね2.4ポイント以内'],
    [{ method: 'exact' as const, value: 0.412 }, ['41.2%'], '41.2パーセント、正確な値'],
    [{ method: 'mc' as const, value: 0.5, halfWidth95: null, samples: null }, ['≈50.0%', '推定'], '約50.0パーセント、推定値'],
  ])('ja %#', async (equity, visible, sr) => {
    const panel = await renderOdds(metrics(equity), 'ja');
    for (const v of visible) expect(panel.textContent).toContain(v);
    if (equity.method === 'exact') {
      expect(panel.textContent).not.toContain('≈');
      expect(panel.textContent).not.toMatch(/正確 |推定/);
    }
    expect(panel.querySelector('.sr-only')?.textContent).toBe(sr);
  });

  it('pot odds and needed rows are omitted when there is nothing to call', async () => {
    const panel = await renderOdds(metrics({ method: 'exact' }, null));
    expect(panel.textContent).not.toContain('Pot odds');
    expect(panel.textContent).not.toContain('Needed to call');
  });
});

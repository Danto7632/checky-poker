// HandResult (US10 AC1-AC4, AF-10): pot rows, returned bets, split, rank lines from RankCode + best5, ja without
// Latin rank words, no-showdown sentence.
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerView } from '@checky/engine/protocol';
import { fakeView } from '../testing/table-fixtures';
import { renderI18n } from '../testing/render';
import { HandResult } from './HandResult';

afterEach(cleanup);

describe('HandResult', () => {
  it('main and side pots with winners, returned bet, rank lines (en)', () => {
    renderI18n(<HandResult view={fakeView('showdown')} />);
    const text = screen.getByTestId('T-02.result').textContent ?? '';
    expect(text).toContain('Main pot 1,250 → Kenji');
    expect(text).toContain('Three of a kind, Queens');
    expect(text).toContain('Side pot 1,000 → Ada');
    expect(text).toContain('Pair of Aces');
    expect(screen.getByTestId('T-02.returned3').textContent).toBe('Returned 1,000 → Ada (not called)');
    expect(text).not.toContain('No showdown');
  });

  it('ja: localized rank lines, no Latin rank words', () => {
    renderI18n(<HandResult view={fakeView('showdown')} />, 'ja');
    const text = screen.getByTestId('T-02.result').textContent ?? '';
    expect(text).toContain('メインポット 1,250 → Kenji');
    expect(text).toContain('Qのスリーカード');
    expect(text).toContain('Aのワンペア');
    expect(text).not.toMatch(/Pair|Three of a kind|Queens|Aces/);
  });

  it('split pot: "Split" badge and each share', () => {
    const v = fakeView('showdown');
    const split: PlayerView = {
      ...v,
      result: { ...v.result!, pots: [{ kind: 'main', amount: 1800, eligible: [1, 3], winners: [1, 3], shares: [900, 900] }], returned: [] },
    };
    renderI18n(<HandResult view={split} />);
    expect(screen.getByText('Split')).toBeTruthy();
    expect(screen.getByTestId('T-02.pot0').textContent).toContain('Main pot 1,800 → Kenji 900, Ada 900');
  });

  it('no showdown: says people\'s cards stay hidden', () => {
    renderI18n(<HandResult view={fakeView('practice-paused')} />);
    expect(screen.getByText("No showdown — people's cards stay hidden.")).toBeTruthy();
  });

  it('renders nothing without a result', () => {
    const { container } = renderI18n(<HandResult view={fakeView('practice-my-turn')} />);
    expect(container.firstChild).toBeNull();
  });
});

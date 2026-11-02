// PR-01 (US18 AC1, AF-01/D28): defaults, 30/60/No limit from defaults.DV4.practice, the help sentence wiring, the
// request objects passed to createPracticeClient, and settings.patch on start.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from '@/config';
import { renderI18n } from '../testing/render';
import { defaultChoice, PracticeSetup, practiceRequest, type PracticeChoice } from './PracticeSetup';

afterEach(cleanup);

describe('defaults', () => {
  it('3 bots, balanced, 60 s, live odds on; blinds 50/100, 100 BB', () => {
    const choice = defaultChoice(true, null);
    expect(choice).toEqual({ bots: 3, style: 'balanced', turnSeconds: 60, liveOdds: true });
    expect(defaults.DV4.practice.default).toBe(60);
    const { settings, bots } = practiceRequest(choice, (n) => `House ${n}`);
    expect(settings).toEqual({ seatCount: 4, sb: 50, bb: 100, startStack: 10000, turnSeconds: 60, liveEquity: true, botChatter: true });
    expect(bots).toEqual([1, 2, 3].map((n) => ({ engine: 'rule', style: 'balanced', provider: null, model: null, label: `House ${n}` })));
  });

  it('prefills from the last practice bots', () => {
    const last = practiceRequest({ bots: 5, style: 'tight', turnSeconds: 30, liveOdds: false }, String).bots;
    expect(defaultChoice(false, last)).toEqual({ bots: 5, style: 'tight', turnSeconds: 60, liveOdds: false });
  });
});

describe('PracticeSetup', () => {
  const setup = (onStart = vi.fn<(c: PracticeChoice) => void>()) => {
    renderI18n(<PracticeSetup initial={defaultChoice(true, null)} busy={false} offlineReady onStart={onStart} />);
    return onStart;
  };

  it('"Deal me in" with defaults starts at once (second click of US18 AC1)', () => {
    const onStart = setup();
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    expect(onStart).toHaveBeenCalledWith({ bots: 3, style: 'balanced', turnSeconds: 60, liveOdds: true });
  });

  it('turn options are 30s / 60s / No limit with full accessible names; no bot-type control (D-P11)', () => {
    setup();
    const radios = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label') ?? r.textContent);
    expect(radios).toEqual(expect.arrayContaining(['30 seconds', '60 seconds', 'No limit']));
    expect(screen.getByTestId('PR-01.turn60').getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Bot type')).toBeNull();
    expect(screen.queryByText('Mixed')).toBeNull();
  });

  it('No limit -> turnSeconds null and the help sentence is linked with aria-describedby', async () => {
    const onStart = setup();
    expect(screen.queryByTestId('PR-01.noLimitHelp')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('PR-01.turnNone'));
    });
    const help = screen.getByTestId('PR-01.noLimitHelp');
    expect(help.textContent).toBe('Take as long as you need. Bots still play at their usual pace.');
    const group = screen.getAllByRole('radiogroup').find((g) => g.getAttribute('aria-describedby') === help.id);
    expect(group).toBeTruthy();
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    expect(onStart).toHaveBeenLastCalledWith(expect.objectContaining({ turnSeconds: null }));
    expect(practiceRequest(onStart.mock.lastCall![0], String).settings.turnSeconds).toBeNull();
  });

  it('bots 1..5 and live odds off', async () => {
    const onStart = setup();
    await act(async () => {
      fireEvent.click(screen.getByTestId('PR-01.bots5'));
      fireEvent.click(screen.getByTestId('PR-01.liveOdds'));
    });
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    expect(onStart).toHaveBeenLastCalledWith({ bots: 5, style: 'balanced', turnSeconds: 60, liveOdds: false });
  });
});

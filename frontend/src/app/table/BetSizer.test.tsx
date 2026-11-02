// BetSizer (components.md 3.9, US8 AC2): the minimum comes from legal; below it confirm is disabled with the
// reason; above the maximum the amount becomes All-in; presets outside the range are hidden.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LegalActions } from '@checky/engine/protocol';
import { renderI18n } from '../testing/render';
import { BetSizer } from './BetSizer';
import { sizerRange } from './format';

afterEach(cleanup);

const LEGAL: LegalActions = { fold: true, check: false, call: { amount: 1000, to: 1000 }, bet: null, raise: { minTo: 1900, maxTo: 9700 }, allIn: { to: 9700 }, reopened: true };

function setup(legal = LEGAL, pot = 2000, lang: 'en' | 'ja' = 'en') {
  const onAct = vi.fn();
  renderI18n(<BetSizer legal={legal} range={sizerRange(legal)!} seat={2} pot={pot} myBet={0} bb={100} busy={false} onAct={onAct} onBack={vi.fn()} />, lang);
  return onAct;
}
const input = () => screen.getByTestId('T-01.sizerInput') as HTMLInputElement;

describe('BetSizer', () => {
  it('1,100 against a 1,900 minimum: confirm disabled + "Minimum raise is 1,900."', () => {
    const onAct = setup();
    fireEvent.change(input(), { target: { value: '1100' } });
    expect(screen.getByRole('alert').textContent).toBe('Minimum raise is 1,900.');
    const confirm = screen.getByTestId('T-01.sizerConfirm');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(confirm);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('a valid amount raises to it', () => {
    const onAct = setup();
    fireEvent.change(input(), { target: { value: '2500' } });
    expect(screen.getByTestId('T-01.sizerConfirm').textContent).toContain('Raise to 2,500');
    fireEvent.click(screen.getByTestId('T-01.sizerConfirm'));
    expect(onAct).toHaveBeenCalledWith({ seat: 2, type: 'raise', to: 2500 });
  });

  it('above the maximum becomes All-in with legal.allIn.to', () => {
    const onAct = setup();
    fireEvent.change(input(), { target: { value: '50000' } });
    expect(screen.getByText("That's all your chips — All-in.")).toBeTruthy();
    expect(screen.getByTestId('T-01.sizerConfirm').textContent).toContain('All-in 9,700');
    fireEvent.click(screen.getByTestId('T-01.sizerConfirm'));
    expect(onAct).toHaveBeenCalledWith({ seat: 2, type: 'allin', to: 9700 });
  });

  it('the All-in preset is always available; fractions >= max are hidden', async () => {
    const short: LegalActions = { ...LEGAL, raise: { minTo: 1900, maxTo: 2400 }, allIn: { to: 2400 } };
    setup(short);
    expect(screen.getByTestId('T-01.presetAllIn')).toBeTruthy();
    expect(screen.queryByTestId('T-01.presetPot')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTestId('T-01.presetAllIn'));
    });
    expect(input().value).toBe('2400');
  });

  it('ja IME: full-width digits ２５００ read as 2,500 (NFKC), confirm raises to 2,500 (review M3)', () => {
    const onAct = setup(LEGAL, 2000, 'ja');
    fireEvent.change(input(), { target: { value: '２５００' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('T-01.sizerConfirm').textContent).toContain('2,500にレイズ');
    fireEvent.click(screen.getByTestId('T-01.sizerConfirm'));
    expect(onAct).toHaveBeenCalledWith({ seat: 2, type: 'raise', to: 2500 });
  });

  it('ja IME: the Enter that commits a composition sends nothing; a plain Enter afterwards confirms (review M3)', () => {
    const onAct = setup(LEGAL, 2000, 'ja');
    // 1900 + IME "０" mid-composition: the committing Enter arrives with isComposing / keyCode 229.
    fireEvent.change(input(), { target: { value: '2５00' } });
    fireEvent.keyDown(input(), { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 });
    fireEvent.keyDown(input(), { key: 'Escape', isComposing: true });
    expect(onAct).not.toHaveBeenCalled();
    expect(screen.getByTestId('T-01.sizerInput')).toBeTruthy(); // Escape while composing did not close the sizer
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 13 });
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct).toHaveBeenCalledWith({ seat: 2, type: 'raise', to: 2500 });
  });

  // R0-L20: ASCII ',' and ' ' are digit grouping and are dropped after NFKC (no grouping check); full-width '，' and
  // the ideographic space become ',' / ' ' through NFKC first. The old code rejected every one of these as "numbers
  // only". The label echoes what would be sent: "2,5" (a locale decimal comma) shows "Raise to 25" and is blocked by
  // the minimum, so the misreading is visible before anything goes out.
  it.each([
    ['en', '2,500', 'Raise to 2,500', { seat: 2, type: 'raise', to: 2500 }],
    ['en', '2 500', 'Raise to 2,500', { seat: 2, type: 'raise', to: 2500 }],
    ['en', '10,000 ', 'All-in 9,700', { seat: 2, type: 'allin', to: 9700 }],
    ['ja', '２，５００', '2,500にレイズ', { seat: 2, type: 'raise', to: 2500 }],
    ['ja', '２\u3000５００', '2,500にレイズ', { seat: 2, type: 'raise', to: 2500 }],
    ['en', '2,5', 'Raise to 25', null],
  ] as const)('%s: %j reads with grouping dropped -> "%s" (R0-L20)', (lang, typed, label, sent) => {
    const onAct = setup(LEGAL, 2000, lang);
    fireEvent.change(input(), { target: { value: typed } });
    expect(screen.queryByText(lang === 'en' ? 'Enter numbers only.' : '数字だけを入力してください。')).toBeNull();
    expect(screen.getByTestId('T-01.sizerConfirm').textContent).toContain(label);
    expect(input().value).toBe(typed); // the field keeps what was typed
    fireEvent.click(screen.getByTestId('T-01.sizerConfirm'));
    if (sent === null) expect(onAct).not.toHaveBeenCalled();
    else expect(onAct).toHaveBeenCalledWith(sent);
  });

  it.each([
    ['en', '2.5', 'Enter numbers only.', 'Raise to —'],
    ['en', '-100', 'Enter numbers only.', 'Raise to —'],
    ['en', '2\t500', 'Enter numbers only.', 'Raise to —'],
    ['ja', '２．５ｋ', '数字だけを入力してください。', '—にレイズ'],
    ['ja', '2、500', '数字だけを入力してください。', '—にレイズ'],
  ] as const)('%s: non-digits left after NFKC and grouping (%s) -> "numbers only", confirm disabled, nothing guessed (review M3)', (lang, typed, message, label) => {
    const onAct = setup(LEGAL, 2000, lang);
    fireEvent.change(input(), { target: { value: typed } });
    expect(screen.getByRole('alert').textContent).toBe(message);
    const confirm = screen.getByTestId('T-01.sizerConfirm');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.textContent).toContain(label);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    fireEvent.click(confirm);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onAct).not.toHaveBeenCalled();
  });

  it.each([
    ['en', '', 'Minimum raise is 1,900.', 'Raise to —'],
    ['en', ',', 'Minimum raise is 1,900.', 'Raise to —'],
    ['ja', '　', '最小レイズ額は1,900です。', '—にレイズ'],
  ] as const)('%s: nothing left to read (%j) -> minimum error and an amount of "—", not 0 (R0-L20)', (lang, typed, message, label) => {
    const onAct = setup(LEGAL, 2000, lang);
    fireEvent.change(input(), { target: { value: typed } });
    expect(screen.getByRole('alert').textContent).toBe(message);
    const confirm = screen.getByTestId('T-01.sizerConfirm');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.textContent).toContain(label);
    fireEvent.click(confirm);
    expect(onAct).not.toHaveBeenCalled();
  });

  it('no "$" anywhere — the placeholder is "Amount"', () => {
    setup();
    expect(input().placeholder).toBe('Amount');
    expect(document.body.textContent).not.toMatch(/\$/);
  });
});

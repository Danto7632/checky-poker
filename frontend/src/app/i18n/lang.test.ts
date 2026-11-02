// Language resolution order (SS27, A-STO-LANG, US43 AC2/AC3) and <html lang> (WCAG 3.1.1).
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Lang } from '@checky/engine/protocol';
import { resolveLang, selectableLangs } from './lang';
import { I18nProvider } from './useT';

afterEach(cleanup);

describe('resolveLang (stored value > browser language)', () => {
  it.each<[Lang | null, string | undefined, boolean, Lang]>([
    [null, 'ja-JP', false, 'ja'],
    [null, 'ja', false, 'ja'],
    [null, 'ko-KR', false, 'en'], // ko flag off
    [null, 'fr', false, 'en'],
    [null, 'en-GB', false, 'en'],
    [null, undefined, false, 'en'],
    [null, 'ko-KR', true, 'ko'],
    ['ja', 'en-US', false, 'ja'], // stored wins
    ['en', 'ja-JP', false, 'en'],
    ['ko', 'ja-JP', false, 'ja'], // stale stored ko without the flag -> browser rule
    ['ko', 'en-US', true, 'ko'],
  ])('stored %s, browser %s, ko flag %s -> %s', (stored, browser, ko, expected) => {
    expect(resolveLang(stored, browser, ko)).toBe(expected);
  });

  it('offers only English and Japanese while ko is off (US43 AC1)', () => {
    expect(selectableLangs(false)).toEqual(['en', 'ja']);
    expect(selectableLangs(true)).toEqual(['en', 'ja', 'ko']);
  });
});

describe('<html lang>', () => {
  it('follows the UI language', () => {
    const { rerender } = render(createElement(I18nProvider, { lang: 'ja', children: 'x' }));
    expect(document.documentElement.lang).toBe('ja');
    rerender(createElement(I18nProvider, { lang: 'en', children: 'x' }));
    expect(document.documentElement.lang).toBe('en');
  });
});

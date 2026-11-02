// Screen guardrails (accessibility.md section 9, C12, SS3 G-1..G-8, US45): every screen of this story, in en and ja,
// renders no currency symbol next to a number, no banned word (contextual rule from frontend/scripts/scan-allow.json,
// the same file scan-dist uses), no remote image, and every win-chance number follows the SC4 rule — an estimate
// always carries "≈" and "Estimate", an exact value never carries "≈".
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import scanAllow from '../../../scripts/scan-allow.json';
import { renderScreen, SCREENS } from '../testing/screens';
import { installDomShims } from '../testing/setup-dom';

installDomShims();
afterEach(cleanup);

interface Rules {
  currency: string;
  banned_everywhere: string[];
  banned_store: string;
  banned_pro: string;
  disclosure_only: { words: string[]; keys: string[] };
}
const rules: Rules = scanAllow;
const latin = (w: string) => /^[\x20-\x7e]+$/.test(w);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w: string) => (latin(w) ? new RegExp(`(?<![A-Za-z0-9])${esc(w)}(?![A-Za-z0-9])`, 'i') : new RegExp(esc(w)));
const disclosureSentences = [en, ja].flatMap((d) => rules.disclosure_only.keys.map((k) => (d as Record<string, string>)[k]).filter((v): v is string => typeof v === 'string'));

function violations(text: string): string[] {
  const out: string[] = [];
  if (new RegExp(rules.currency).test(text)) out.push('S5 currency next to a number');
  for (const w of rules.banned_everywhere) if (wordRe(w).test(text)) out.push(`S6 ${w}`);
  if (new RegExp(rules.banned_store, 'i').test(text)) out.push('S6 store');
  if (new RegExp(rules.banned_pro).test(text)) out.push('S6 PRO');
  let rest = text;
  for (const s of disclosureSentences) rest = rest.split(s).join(' ');
  for (const w of rules.disclosure_only.words) if (wordRe(w).test(rest)) out.push(`S6 ${w} outside a G-2 disclosure`);
  return out;
}

describe.each(['en', 'ja'] as const)('guardrails (%s)', (lang) => {
  it.each(SCREENS.map((s) => [s.id, s] as const))('%s', async (_, c) => {
    const { container } = await renderScreen(c, lang);
    const text = document.body.textContent ?? '';
    expect(violations(text)).toEqual([]);
    expect(container.querySelectorAll('img[src^="http"], img[src^="//"]')).toHaveLength(0);
    // C12: the win-chance panel, when present, must match its method.
    const odds = document.querySelector('[data-testid="T-01.liveOdds"]');
    if (odds) {
      const value = odds.querySelector('dd span[aria-hidden="true"]')?.textContent ?? '';
      const estimate = odds.querySelector('[data-testid="T-01.oddsBadge"]') !== null;
      if (estimate) {
        expect(value.startsWith('≈')).toBe(true);
        expect(odds.textContent).toMatch(lang === 'en' ? /Estimate/ : /推定/);
      } else {
        expect(value).not.toContain('≈');
      }
    }
  });
});

describe('C12 sanity: the check sees both methods', () => {
  it('renders one estimate and one exact case', async () => {
    const mc = SCREENS.find((s) => s.id === 'T-01 my turn (mc odds)')!;
    await renderScreen(mc, 'en');
    expect(document.querySelector('[data-testid="T-01.oddsBadge"]')?.textContent).toBe('Estimate ±2.4%');
    cleanup();
    const exact = SCREENS.find((s) => s.id === 'T-01 my turn (exact odds)')!;
    await renderScreen(exact, 'en');
    expect(document.querySelector('[data-testid="T-01.oddsBadge"]')).toBeNull();
  });
});

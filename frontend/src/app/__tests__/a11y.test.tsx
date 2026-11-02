// Automated accessibility check with axe-core on the main screens (G-01, P-01, H-01, PR-01, T-01 my turn + the rest
// of this story's screens). happy-dom has no layout, so rules that need rendering geometry (color-contrast) are off;
// contrast is computed from tokens in fonts-contrast.test.ts and re-checked in a real browser in W6.
import axe from 'axe-core';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen, SCREENS } from '../testing/screens';
import { installDomShims } from '../testing/setup-dom';

installDomShims();
afterEach(cleanup);

describe.each(['en', 'ja'] as const)('axe (%s)', (lang) => {
  it.each(SCREENS.map((s) => [s.id, s] as const))('%s has no violations', async (_, c) => {
    await renderScreen(c, lang);
    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false } }, resultTypes: ['violations'] });
    const summary = result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(summary).toEqual([]);
  });
});

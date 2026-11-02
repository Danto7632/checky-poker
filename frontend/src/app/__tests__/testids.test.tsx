// E2E selector convention (api.config.v1 e2e_hooks.selectors, this story fixes it): data-testid =
// "<screen id>.<lowerCamel element>", screen id [A-Z]{1,2}-\d{2}; no duplicates on a rendered screen. Accessible
// names stay the first-choice selector; test ids are the fallback. The table of ids is in 08-impl-notes/frontend.md.
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderScreen, SCREENS } from '../testing/screens';
import { installDomShims } from '../testing/setup-dom';

installDomShims();
afterEach(cleanup);

const FORMAT = /^[A-Z]{1,2}-\d{2}\.[a-z][A-Za-z0-9]*$/;

describe('data-testid convention', () => {
  it.each(SCREENS.map((s) => [s.id, s] as const))('%s', async (_, c) => {
    await renderScreen(c, 'en');
    const ids = [...document.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid') ?? '');
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !FORMAT.test(id))).toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

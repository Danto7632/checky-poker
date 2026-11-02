// H-01 (R0 part): the only links are Practice and the profile edit link — no dead entry points (US45 AC1).
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderRoutes } from '../testing/render';
import { AppHome } from './AppHome';

afterEach(cleanup);

describe('AppHome', () => {
  it('greets with the nickname and links only to /practice and /settings#profile', async () => {
    renderRoutes([{ path: '/app', element: <AppHome /> }], '/app');
    expect(await screen.findByText('Hi, Mina')).toBeTruthy();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.sort()).toEqual(['/practice', '/settings#profile']);
    expect(screen.getByText('Play money only — no cash value · Not gambling · 18+')).toBeTruthy();
  });

  it('shows the storage banner on E-STO-UNAVAILABLE', async () => {
    const h = renderRoutes([{ path: '/app', element: <AppHome /> }], '/app');
    await screen.findByText('Hi, Mina');
    expect(screen.queryByTestId('H-01.storageBanner')).toBeNull();
    h.storage.setIssue('E-STO-UNAVAILABLE');
    expect(await screen.findByTestId('H-01.storageBanner')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("isn't letting Checky Poker save data");
  });

  it('greets in Japanese', async () => {
    renderRoutes([{ path: '/app', element: <AppHome /> }], '/app', { lang: 'ja' });
    expect(await screen.findByText('こんにちは、Minaさん')).toBeTruthy();
  });
});

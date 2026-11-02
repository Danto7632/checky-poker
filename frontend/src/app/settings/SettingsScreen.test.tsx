// S-01 profile + language (FS-SET-1, US2 AC3, US43 AC4/AC1).
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../shell/AppShell';
import { renderRoutes } from '../testing/render';
import { SettingsScreen } from './SettingsScreen';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const routes = () => [{ path: '/settings', element: <AppShell><SettingsScreen /></AppShell> }];

describe('SettingsScreen / ProfileSection', () => {
  it('saves a nickname change on blur and shows "Saved" for 1.5 s', async () => {
    const h = renderRoutes(routes(), '/settings#profile');
    const input = (await screen.findAllByLabelText('Nickname'))[0] as HTMLInputElement;
    await screen.findByDisplayValue('Mina');
    fireEvent.change(input, { target: { value: 'Mina2' } });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.blur(input);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId('S-01.saved').textContent).toBe('Saved');
    expect((await h.storage.profile.get())?.nickname).toBe('Mina2');
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByTestId('S-01.saved').textContent).toBe('');
  });

  it('offers only English and 日本語 and persists the switch with the profile (US43 AC1/AC4)', async () => {
    const h = renderRoutes(routes(), '/settings#profile');
    await screen.findByDisplayValue('Mina');
    const select = screen.getByTestId('S-01.language') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['English', '日本語']);
    await act(async () => {
      fireEvent.change(select, { target: { value: 'ja' } });
    });
    expect(await screen.findByRole('heading', { level: 1, name: '設定' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('ja');
    expect((await h.storage.profile.get())?.lang).toBe('ja');
    expect(h.storage.lang.get()).toBe('ja');
  });

  it('a language picked before a profile exists survives a revisit (lang.set path)', async () => {
    const h = renderRoutes(routes(), '/settings', { profile: null });
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'ja' } });
    });
    expect(h.storage.lang.get()).toBe('ja');
    cleanup();
    renderRoutes(routes(), '/settings', { storage: h.storage, services: h.services, profile: null });
    expect(await screen.findByRole('heading', { level: 1, name: '設定' })).toBeTruthy();
  });
});

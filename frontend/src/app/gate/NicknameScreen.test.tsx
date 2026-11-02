// P-01 (US2 AC1/AC2, FS-GATE-5): one field, local avatar, three error rules, no network on save.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GateRoute } from '../shell/GateRoute';
import { renderRoutes } from '../testing/render';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const routes = () => [{ element: <GateRoute />, children: [{ path: '/app', element: <p>home screen</p> }] }];
const field = () => screen.getByLabelText('Nickname') as HTMLInputElement;
const continueButton = () => screen.getByTestId('P-01.continue');

describe('NicknameScreen', () => {
  it('saves nickname + avatar + UI language locally with zero network calls (US2 AC1)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
    const ws = vi.fn();
    vi.stubGlobal('WebSocket', ws);
    const h = renderRoutes(routes(), '/app', { profile: null, lang: 'ja' });
    const input = await screen.findByLabelText('ニックネーム');
    expect(input.getAttribute('autocomplete')).toBe('nickname');
    expect(document.querySelectorAll('input')).toHaveLength(1); // one field only
    fireEvent.change(input, { target: { value: '  Kai  ' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('P-01.continue'));
    });
    await screen.findByText('home screen');
    const saved = await h.storage.profile.get();
    expect(saved).toMatchObject({ nickname: 'Kai', lang: 'ja' });
    expect(typeof saved?.avatarSeed).toBe('number');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrOpen).not.toHaveBeenCalled();
    expect(ws).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('empty: button disabled, the error appears only after leaving the field', async () => {
    renderRoutes(routes(), '/app', { profile: null });
    await screen.findByLabelText('Nickname');
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByText('Enter a nickname.')).toBeNull();
    fireEvent.blur(field());
    expect(screen.getByText('Enter a nickname.')).toBeTruthy();
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('spaces only: immediate error, disabled', async () => {
    renderRoutes(routes(), '/app', { profile: null });
    fireEvent.change(await screen.findByLabelText('Nickname'), { target: { value: '   ' } });
    expect(screen.getByText("A nickname can't be only spaces.")).toBeTruthy();
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('17 code points: immediate error; 16 emoji are fine (code points, M3A-11)', async () => {
    renderRoutes(routes(), '/app', { profile: null });
    fireEvent.change(await screen.findByLabelText('Nickname'), { target: { value: 'a'.repeat(17) } });
    expect(screen.getByText('Use 16 characters or fewer.')).toBeTruthy();
    expect(continueButton().getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(field(), { target: { value: '😀'.repeat(16) } });
    expect(screen.queryByText('Use 16 characters or fewer.')).toBeNull();
    expect(continueButton().getAttribute('aria-disabled')).toBeNull();
    expect(screen.getByText('16/16')).toBeTruthy();
  });

  it('avatar is a local SVG: no remote image (US2 AC4)', async () => {
    renderRoutes(routes(), '/app', { profile: null });
    await screen.findByLabelText('Nickname');
    expect(document.querySelectorAll('img[src^="http"]')).toHaveLength(0);
    expect(document.querySelectorAll('svg circle').length).toBeGreaterThan(0);
  });
});

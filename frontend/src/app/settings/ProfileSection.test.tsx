// S-01 ProfileSection (FS-SET-1, US2): what is saved when, what is refused, and that two profile writes in flight
// (nickname save + language switch) both survive (review m5). "Saved for 1.5 s" and the language list are covered
// in SettingsScreen.test.tsx.
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../shell/AppShell';
import { renderRoutes } from '../testing/render';
import { SettingsScreen } from './SettingsScreen';

afterEach(cleanup);

const routes = () => [{ path: '/settings', element: <AppShell><SettingsScreen /></AppShell> }];

async function setup() {
  const h = renderRoutes(routes(), '/settings#profile');
  const input = (await screen.findByDisplayValue('Mina')) as HTMLInputElement;
  const save = vi.spyOn(h.storage.profile, 'save');
  return { h, input, save };
}

describe('ProfileSection', () => {
  it('blur without a change writes nothing', async () => {
    const { input, save } = await setup();
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByTestId('S-01.saved').textContent).toBe('');
  });

  it('a blank nickname is refused on blur with the field error, and nothing is written', async () => {
    const { input, save } = await setup();
    fireEvent.change(input, { target: { value: '   ' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(save).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('saves the trimmed nickname with the current language', async () => {
    const { h, input, save } = await setup();
    fireEvent.change(input, { target: { value: '  Ken  ' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(save).toHaveBeenCalledWith({ nickname: '  Ken  ', avatarSeed: 7, lang: 'en' });
    expect(await h.storage.profile.get()).toMatchObject({ nickname: 'Ken', avatarSeed: 7, lang: 'en' });
  });

  it('Shuffle saves the new avatar at once (no blur needed)', async () => {
    const { h, save } = await setup();
    await act(async () => {
      fireEvent.click(screen.getByTestId('S-01.shuffle'));
    });
    expect(save).toHaveBeenCalledTimes(1);
    const stored = await h.storage.profile.get();
    expect(stored?.nickname).toBe('Mina');
    expect(stored?.avatarSeed).toBe(save.mock.calls[0]![0].avatarSeed);
  });

  it('a storage refusal shows the contract message under the field', async () => {
    const { h, input } = await setup();
    h.storage.profile.save = () => Promise.reject(Object.assign(new Error('E-PROFILE-NICK-INVALID'), { code: 'E-PROFILE-NICK-INVALID' }));
    fireEvent.change(input, { target: { value: 'Ken' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    // err.E-PROFILE-NICK-INVALID in the field's error slot (the same words also sit in the hint below it).
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
    const errorId = input.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-error'));
    expect(document.getElementById(errorId ?? '')?.textContent).toContain('1–16 characters. Shown at the table.');
    expect(screen.getByTestId('S-01.saved').textContent).toBe('');
  });

  it('switching language while a nickname save is still in flight keeps both (review m5)', async () => {
    const { h, input } = await setup();
    const realSave = h.storage.profile.save.bind(h.storage.profile);
    let release!: () => void;
    const held = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    // The first write (the nickname) is slow, like an IndexedDB round trip under load.
    h.storage.profile.save = async (p) => {
      if (first) {
        first = false;
        await held;
      }
      return realSave(p);
    };
    fireEvent.change(input, { target: { value: 'Mina2' } });
    fireEvent.blur(input);
    await act(async () => {
      fireEvent.change(screen.getByTestId('S-01.language'), { target: { value: 'ja' } });
    });
    await act(async () => {
      release();
      await held;
    });
    await waitFor(async () => expect(await h.storage.profile.get()).toMatchObject({ nickname: 'Mina2', lang: 'ja' }));
    expect(h.storage.lang.get()).toBe('ja');
    expect(await screen.findByRole('heading', { level: 1, name: '設定' })).toBeTruthy();
    expect((screen.getAllByDisplayValue('Mina2')[0] as HTMLInputElement).value).toBe('Mina2');
  });
});

// A-APP-BOOT: secret fragments move to sessionStorage and leave the address bar before React; other fragments stay.
// Also asserts that main.tsx imports the boot module first (ES module evaluation order is the guarantee), and that
// the app shell needs no inline style or script (review m8).
import { describe, expect, it, vi } from 'vitest';
import mainSource from '../../main.tsx?raw';
import { readRepoFile } from '../testing/node-fs';
import { BOOT_KEY, captureBootDestination, REPLAY_KEY, type BootEnv } from './boot';

function env(pathname: string, hash: string) {
  const store = new Map<string, string>();
  const replaceState = vi.fn();
  const e: BootEnv = {
    location: { pathname, hash },
    history: { replaceState },
    sessionStorage: { setItem: (k: string, v: string) => void store.set(k, v) },
  };
  return { e, store, replaceState };
}

describe('captureBootDestination (4 paths)', () => {
  it('/join#CODE -> cp.boot.v1 {route, secret}, hash removed, path kept', () => {
    const { e, store, replaceState } = env('/join', '#K7Q2MA9XPB');
    expect(captureBootDestination(e)).toEqual({ route: '/join', secret: 'K7Q2MA9XPB' });
    expect(JSON.parse(store.get(BOOT_KEY) ?? 'null')).toEqual({ route: '/join', secret: 'K7Q2MA9XPB' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/join');
  });

  it('/replay#1.payload -> cp.replay.v1, hash removed', () => {
    const { e, store, replaceState } = env('/replay', '#1.eNqrVkrOz0');
    expect(captureBootDestination(e)).toEqual({ route: '/replay', secret: '1.eNqrVkrOz0' });
    expect(store.get(REPLAY_KEY)).toBe('1.eNqrVkrOz0');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/replay');
  });

  it.each([
    ['/history', '#h=abc123'],
    ['/settings', '#keys'],
  ])('%s%s is not secret: nothing stored, hash kept', (path, hash) => {
    const { e, store, replaceState } = env(path, hash);
    expect(captureBootDestination(e)).toEqual({ route: path, secret: null });
    expect(store.size).toBe(0);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('keeps the secret in memory and still strips the hash when sessionStorage throws', () => {
    const replaceState = vi.fn();
    const e: BootEnv = {
      location: { pathname: '/join', hash: '#ABCDE23456' },
      history: { replaceState },
      sessionStorage: {
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
    };
    expect(captureBootDestination(e)).toEqual({ route: '/join', secret: 'ABCDE23456' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/join');
  });

  it('/join without a fragment changes nothing', () => {
    const { e, store, replaceState } = env('/join', '');
    expect(captureBootDestination(e)).toEqual({ route: '/join', secret: null });
    expect(store.size).toBe(0);
    expect(replaceState).not.toHaveBeenCalled();
  });
});

describe('main.tsx', () => {
  it('imports the boot module before anything else', () => {
    const firstImport = mainSource.split('\n').find((line: string) => line.startsWith('import '));
    expect(firstImport).toBe("import './app/shell/boot.ts';");
  });
});

describe('app.html (CSP, ADR-0014)', () => {
  it('has no inline <style> or style="" (works without style-src \'unsafe-inline\'); the fallback rule is in theme.css', () => {
    const html = readRepoFile('frontend/app.html').replace(/<!--[\s\S]*?-->/g, '');
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
    expect(html).not.toMatch(/<script\b(?![^>]*\bsrc=)[^>]*>/i); // and no inline script
    expect(html).toContain('class="cp-boot-fallback"');
    expect(readRepoFile('frontend/src/styles/theme.css')).toMatch(/\.cp-boot-fallback \{[^}]*animation: cp-boot-show 0s linear 3s forwards;/);
  });
});

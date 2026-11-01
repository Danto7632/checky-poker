import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadVersion() {
  vi.resetModules();
  return (await import('./app-version')).APP_VERSION;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('APP_VERSION', () => {
  it('falls back to "dev" when VITE_APP_VERSION is not injected', async () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    expect(await loadVersion()).toBe('dev');
  });

  it('uses VITE_APP_VERSION when present', async () => {
    vi.stubEnv('VITE_APP_VERSION', 'abc1234');
    expect(await loadVersion()).toBe('abc1234');
  });
});

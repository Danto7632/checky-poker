import { afterEach, describe, expect, it, vi } from 'vitest';
import { getE2EHooks } from './e2e';

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__CHECKY_E2E__;
});

describe('getE2EHooks', () => {
  it('returns null when VITE_E2E is not "true", even if the global exists', () => {
    vi.stubEnv('VITE_E2E', 'false');
    window.__CHECKY_E2E__ = { dv: { DV7: 3000 }, testSeed: 'x', tap: true };
    expect(getE2EHooks()).toBeNull();
  });

  it('returns null in an E2E build when the global is missing or not an object', () => {
    vi.stubEnv('VITE_E2E', 'true');
    expect(getE2EHooks()).toBeNull();
    window.__CHECKY_E2E__ = 'nope';
    expect(getE2EHooks()).toBeNull();
    window.__CHECKY_E2E__ = [1, 2];
    expect(getE2EHooks()).toBeNull();
  });

  it('returns the documented shape in an E2E build', () => {
    vi.stubEnv('VITE_E2E', 'true');
    window.__CHECKY_E2E__ = {
      dv: { DV7: 3000 },
      testSeed: 'seed-1',
      llm: { delayMs: 5 },
      relays: { nostr: ['ws://127.0.0.1:7777'], mqtt: [] },
      tap: true,
    };
    expect(getE2EHooks()).toEqual({
      dv: { DV7: 3000 },
      testSeed: 'seed-1',
      llm: { delayMs: 5 },
      relays: { nostr: ['ws://127.0.0.1:7777'], mqtt: [] },
      tap: true,
    });
  });

  it('drops keys with the wrong shape and keeps the right ones', () => {
    vi.stubEnv('VITE_E2E', 'true');
    window.__CHECKY_E2E__ = {
      dv: 'x',
      testSeed: 42,
      llm: 'x',
      relays: { nostr: ['a'], mqtt: 'b' },
      tap: 'yes',
      extra: 1,
    };
    expect(getE2EHooks()).toEqual({});
    window.__CHECKY_E2E__ = { testSeed: 's', relays: null, llm: null };
    expect(getE2EHooks()).toEqual({ testSeed: 's', relays: null, llm: null });
  });
});

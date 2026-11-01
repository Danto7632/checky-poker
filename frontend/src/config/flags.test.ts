import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadFlags() {
  vi.resetModules();
  return (await import('./flags')).flags;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('flags (release build defaults, table B)', () => {
  it('has exactly the 8 documented flags with the documented defaults', async () => {
    const flags = await loadFlags();
    expect(flags).toEqual({
      FEATURE_SERVER: false,
      FEATURE_KO: false,
      FEATURE_LOCAL_LLM: true,
      FEATURE_ARENA: true,
      FEATURE_LANDING_DEMO: true,
      FEATURE_TURN: false,
      ADULT_CHECK: '',
      E2E: false,
    });
    expect(Object.keys(flags)).toHaveLength(8);
  });

  it('turns default-false flags on only for the string "true"', async () => {
    vi.stubEnv('VITE_FEATURE_SERVER', 'true');
    vi.stubEnv('VITE_FEATURE_KO', '1');
    vi.stubEnv('VITE_E2E', 'true');
    const flags = await loadFlags();
    expect(flags.FEATURE_SERVER).toBe(true);
    expect(flags.FEATURE_KO).toBe(false);
    expect(flags.E2E).toBe(true);
  });

  it('turns default-true flags off only for the string "false"', async () => {
    vi.stubEnv('VITE_FEATURE_LOCAL_LLM', 'false');
    vi.stubEnv('VITE_FEATURE_ARENA', '0');
    const flags = await loadFlags();
    expect(flags.FEATURE_LOCAL_LLM).toBe(false);
    expect(flags.FEATURE_ARENA).toBe(true);
  });

  it('passes the adult-check language list through', async () => {
    vi.stubEnv('VITE_ADULT_CHECK', 'ko');
    expect((await loadFlags()).ADULT_CHECK).toBe('ko');
  });

  it('runs in the happy-dom environment (frontend project)', () => {
    expect(typeof document).toBe('object');
  });
});

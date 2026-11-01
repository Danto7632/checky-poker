import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaults } from './defaults';

async function loadDefaults() {
  vi.resetModules();
  return (await import('./defaults')).defaults;
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__CHECKY_E2E__;
});

describe('defaults (table C-2)', () => {
  it('has the documented keys and values', () => {
    expect(defaults).toEqual({
      DV1: { min: 2, max: 6, default: 6 },
      DV2: { sb: 50, bb: 100 },
      DV3: { bbOptions: [50, 100, 200], defaultBb: 100 },
      DV4: {
        friend: { options: [15, 30, 60], default: 30 },
        practice: { options: [30, 60, null], default: 60 },
      },
      DV5: { nextHandMs: 5000, withRevealMs: 8000 },
      DV6: 3,
      DV7: 30000,
      DV8: { hostSilenceMs: 3500, showWithinMs: 5000 },
      DV9: 10000,
      DV10: 300,
      DV11: { maxLen: 120, perAction: 1 },
      DV12: { maxLen: 200, perSec: 1 },
      DV13: 200,
      DV14: 10,
      DV15: 2000,
      DV16: { min: 1, max: 16 },
      DV17: { length: 10, alphabet: '23456789ABCDEFGHJKMNPQRSTUVWXYZ' },
      DV18: 18,
      DV19: { relayMs: 10000, findHostMs: 20000, seatMs: 5000 },
      DV20: 10000,
      DV21: 1000,
      DV22: 2000,
      DV23: { halfWidthMax: 0.01, minSamples: 9604 },
      DV24: 10000,
      DV25: { computeMaxMs: 1000, thinkMs: [800, 1500] },
      DV26: false,
      DV27: { practice: true, friend: false },
      heartbeatMs: 1000,
      guestSilenceMs: 5000,
      hostOnlineFrameWindowMs: 3500,
      maxEnvelopeBytes: 65536,
      guestRatePerSec: 20,
      proofAnswersPerPeerPerSec: 5,
      runoutDelaysMs: [450, 700],
      coachTimeoutMs: 45000,
      connTestTimeoutMs: 10000,
      debugLogSize: 500,
    });
  });

  it('DV4: friend 15/30/60 default 30, practice 30/60/null default 60 (AF-01)', () => {
    expect(defaults.DV4.friend.options).toEqual([15, 30, 60]);
    expect(defaults.DV4.friend.default).toBe(30);
    expect(defaults.DV4.practice.options).toEqual([30, 60, null]);
    expect(defaults.DV4.practice.default).toBe(60);
  });

  it('DV17 alphabet has 31 characters and no 0/1/I/L/O', () => {
    expect(defaults.DV17.alphabet).toHaveLength(31);
    expect(defaults.DV17.alphabet).not.toMatch(/[01ILO]/);
  });
});

describe('E2E dv override guard', () => {
  it('ignores window.__CHECKY_E2E__ when VITE_E2E is not "true"', async () => {
    vi.stubEnv('VITE_E2E', 'false');
    window.__CHECKY_E2E__ = { dv: { DV7: 3000 } };
    const d = await loadDefaults();
    expect(d.DV7).toBe(30000);
  });

  it('merges a partial dv object (one level, same keys) when VITE_E2E is "true"', async () => {
    vi.stubEnv('VITE_E2E', 'true');
    window.__CHECKY_E2E__ = { dv: { DV7: 3000, DV5: { nextHandMs: 100, withRevealMs: 200 } } };
    const d = await loadDefaults();
    expect(d.DV7).toBe(3000);
    expect(d.DV5).toEqual({ nextHandMs: 100, withRevealMs: 200 });
    expect(d.DV9).toBe(10000);
  });

  it('drops unknown keys and values of another shape', async () => {
    vi.stubEnv('VITE_E2E', 'true');
    window.__CHECKY_E2E__ = { dv: { NOPE: 1, DV7: 'fast', DV8: [1], DV6: 1 } };
    const d = await loadDefaults();
    expect(d).not.toHaveProperty('NOPE');
    expect(d.DV7).toBe(30000);
    expect(d.DV8).toEqual({ hostSilenceMs: 3500, showWithinMs: 5000 });
    expect(d.DV6).toBe(1);
  });
});

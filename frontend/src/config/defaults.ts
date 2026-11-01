import { getE2EHooks } from './e2e';

// DV1..DV27 (service-stories section 0, v1.2) plus architecture constants. Keys are the DV ids themselves.
const BASE = {
  DV1: { min: 2, max: 6, default: 6 },
  DV2: { sb: 50, bb: 100 },
  DV3: { bbOptions: [50, 100, 200], defaultBb: 100 },
  DV4: {
    friend: { options: [15, 30, 60], default: 30 },
    // null = no time limit (practice only, AF-01 / D-L11)
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
  // Code points (M3A-11)
  DV16: { min: 1, max: 16 },
  DV17: { length: 10, alphabet: '23456789ABCDEFGHJKMNPQRSTUVWXYZ' },
  DV18: 18,
  DV19: { relayMs: 10000, findHostMs: 20000, seatMs: 5000 },
  // p50 target
  DV20: 10000,
  DV21: 1000,
  DV22: 2000,
  DV23: { halfWidthMax: 0.01, minSamples: 9604 },
  DV24: 10000,
  DV25: { computeMaxMs: 1000, thinkMs: [800, 1500] },
  DV26: false,
  DV27: { practice: true, friend: false },
  // Architecture constants
  heartbeatMs: 1000,
  guestSilenceMs: 5000,
  // W.ONLINE
  hostOnlineFrameWindowMs: 3500,
  maxEnvelopeBytes: 65536,
  guestRatePerSec: 20,
  proofAnswersPerPeerPerSec: 5,
  runoutDelaysMs: [450, 700],
  coachTimeoutMs: 45000,
  connTestTimeoutMs: 10000,
  debugLogSize: 500,
} as const;

export type Defaults = typeof BASE;

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// One-level shallow merge of the E2E `dv` object. Unknown keys and values of a different JS shape are dropped.
function applyE2E(base: Defaults): Defaults {
  const hooks = getE2EHooks();
  if (hooks === null || hooks.dv === undefined) return base;
  const merged: Record<string, unknown> = { ...base };
  const baseRec: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(hooks.dv)) {
    if (!Object.hasOwn(baseRec, key)) continue;
    const current = baseRec[key];
    const sameShape =
      typeof value === typeof current && Array.isArray(value) === Array.isArray(current) && isPlain(value) === isPlain(current);
    if (sameShape) merged[key] = value;
  }
  // Literal types describe the release values; E2E builds may override them at runtime only.
  return merged as unknown as Defaults;
}

export const defaults: Defaults = applyE2E(BASE);

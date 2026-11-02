// AC-16 (SC4, Q-001, MS-R2-5 lead-in): bot-precision metadata is correct, because it reaches the reveal panel
// and the arena as MetricsLite ("≈ + Estimate ±x%").
// Rule (golden_rule.bot_mc): Monte Carlo spots (>= 100) samples >= N_BOT, halfWidth95 = 1.96 sqrt(p(1-p)/n)
// within 1e-9 and <= 0.031, coverage >= 90%, every |err| <= 3 * halfWidth95; exact spots carry null metadata.
// Edge spots (reference p < 0.02 or > 0.98) leave the coverage set and are held to
// |err| <= 3 * 1.96 * sqrt(p_ref(1 - p_ref)/n) + 1/n (lead review R0 3.2 m4). Same oracle file and per-spot seeds
// as the display golden; the oracle file is required (pending must be 0).
import { describe, expect, it } from 'vitest';
import { N_BOT } from '../src/metrics/equity';
import { computeMetrics } from '../src/metrics/metrics';
import { judge, loadReference, loadSpots, spotRng, spotView } from './helpers/golden';
import { log } from './helpers/io';

const spots = loadSpots();
const reference = loadReference(spots);
const computed = spots.map((spot) => ({ spot, m: computeMetrics(spotView(spot), { precision: 'bot', rng: spotRng(spot) }).equity }));

describe('equity — bot precision metadata', () => {
  it('>= 100 spots end Monte Carlo; metadata is exact to the formula', () => {
    const mc = computed.filter((c) => c.m.method === 'mc');
    expect(mc.length).toBeGreaterThanOrEqual(100);
    for (const { spot, m } of computed) {
      if (m.method === 'exact') {
        expect([m.samples, m.halfWidth95], spot.id).toEqual([null, null]);
        continue;
      }
      expect(m.samples!, spot.id).toBeGreaterThanOrEqual(N_BOT);
      expect(Math.abs(m.halfWidth95! - 1.96 * Math.sqrt((m.value * (1 - m.value)) / m.samples!)), spot.id).toBeLessThanOrEqual(1e-9);
      expect(m.halfWidth95!, spot.id).toBeLessThanOrEqual(0.031);
    }
  });

  it('covers the independent oracle', () => {
    const values = new Map((reference?.values ?? []).map((v) => [v.id, v]));
    // Exact bot spots are held to the display exact rule (1e-6) inside judge.
    const j = judge(computed, values, { k: 3 });
    log(
      `bot precision: N_BOT=${N_BOT} methods exact=${computed.filter((c) => c.m.method === 'exact').length} mc=${computed.filter((c) => c.m.method === 'mc').length} | ` +
        `mc=${j.core} edge=${j.edge} pending=${j.pending} coverage=${j.coverage === null ? '-' : (100 * j.coverage).toFixed(1)}% max|err|=${j.maxErr.toFixed(4)} max|err|/hw=${j.maxRatio.toFixed(2)} ` +
        `maxEdgeErr/tol=${j.maxEdgeRatio.toFixed(2)}`,
    );
    expect(reference, 'fixtures/equity-golden.json (lead oracle) is missing').not.toBeNull();
    expect(j.pending).toBe(0);
    expect(j.violations).toEqual([]);
    expect(j.coverage).toBeGreaterThanOrEqual(0.9);
    expect(j.core).toBeGreaterThanOrEqual(100); // coverage is judged over >= 100 non-edge Monte Carlo spots
  });
});

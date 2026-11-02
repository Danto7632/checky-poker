// AC-9 (SS20-AC1, US20 AC3, MS-R3-1 lead-in): display-precision equity against the lead's independent oracle.
// Pass rule (api.analysis.v1 golden_rule, DV23): exact spots |value - ref| <= 1e-6 with null precision metadata;
// Monte Carlo spots (>= 100) samples >= 9,604, halfWidth95 <= 0.01, coverage (|err| <= halfWidth95) >= 90% and
// every |err| <= 2 * halfWidth95. Spots whose reference p is < 0.02 or > 0.98 leave the coverage set and are held
// to |err| <= 2 * 1.96 * sqrt(p_ref(1 - p_ref)/n) + 1/n instead (edge_spots, lead review R0 3.2 m4). Seeds are per
// spot and never changed to make a run pass. The oracle file is required: every spot must have a reference value.
// Measured 2026-11-01 (Node 24.15, M3 Pro): see the "golden display:" line and ml.md.
import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/metrics/metrics';
import { judge, loadReference, loadSpots, spotRng, spotView } from './helpers/golden';
import { log } from './helpers/io';

const spots = loadSpots();
const reference = loadReference(spots);
const computed = spots.map((spot) => ({ spot, m: computeMetrics(spotView(spot), { precision: 'display', rng: spotRng(spot) }).equity }));

describe('equity golden — display precision', () => {
  it('inputs: >= 120 spots, preflop..river x 1..5 opponents, >= 100 end Monte Carlo', () => {
    expect(spots.length).toBeGreaterThanOrEqual(120);
    for (const len of [0, 3, 4, 5]) for (let n = 1; n <= 5; n += 1) expect(spots.some((s) => s.board.length === len && s.opponents === n)).toBe(true);
    expect(computed.filter((c) => c.m.method === 'mc').length).toBeGreaterThanOrEqual(100);
  });

  it('precision metadata holds on every spot (no reference needed)', () => {
    for (const { spot, m } of computed) {
      expect(m.opponents, spot.id).toBe(spot.opponents);
      if (m.method === 'exact') expect([m.samples, m.halfWidth95], spot.id).toEqual([null, null]);
      else {
        expect(m.samples!, spot.id).toBeGreaterThanOrEqual(9604);
        expect(m.halfWidth95!, spot.id).toBeLessThanOrEqual(0.01);
      }
    }
  });

  it('matches the independent oracle', () => {
    const values = new Map((reference?.values ?? []).map((v) => [v.id, v]));
    const j = judge(computed, values, { k: 2 });
    const methods = `methods exact=${computed.filter((c) => c.m.method === 'exact').length} mc=${computed.filter((c) => c.m.method === 'mc').length}`;
    const oracle = reference === null ? 'none' : `${reference.reference.tool} ${reference.reference.version} by ${reference.reference.by}`;
    log(
      `golden display: ${methods} | cases=${j.exact + j.core + j.edge} exact=${j.exact} mc=${j.core} edge=${j.edge} pending=${j.pending} ` +
        `maxExactErr=${j.maxExactErr.toExponential(2)} coverage=${j.coverage === null ? '-' : (100 * j.coverage).toFixed(1)}% maxErr/hw=${j.maxRatio.toFixed(2)} ` +
        `maxEdgeErr/tol=${j.maxEdgeRatio.toFixed(2)} oracle=${oracle}`,
    );
    expect(reference, 'fixtures/equity-golden.json (lead oracle) is missing').not.toBeNull();
    expect(j.pending).toBe(0);
    expect(j.violations).toEqual([]);
    expect(j.coverage).toBeGreaterThanOrEqual(0.9);
    expect(j.core).toBeGreaterThanOrEqual(100); // coverage is judged over >= 100 non-edge Monte Carlo spots
  });
});

// SC4 equity golden: fixture loading, shape checks and the per-spot setup shared by the display (AC-9) and bot
// precision (AC-16) tests. Rules = api.analysis.v1 A-ANL-METRICS golden_rule (1.0.4-p1), edge spots per the lead
// review R0 3.2 m4.
//
// Inputs: fixtures/equity-golden.spots.json (Stephen). Reference values: fixtures/equity-golden.json, produced by
// the lead with an implementation independent of this repository's evaluator (M17R-01); read-only for Stephen
// (never edited or regenerated here). A spot without a reference value is reported as pending; the two golden
// tests require pending = 0.
//
// Seeds: one per spot, seed = fnv1a32(spotId) (RG1-L-03), passed to the engine's seeded Rng as a number.
import type { Card } from '@checky/engine/protocol';
import { createSeededRng, type Rng } from '@checky/engine/util';
import type { MetricsView } from '../../src/bot/contract';
import { buildSpot, limpedSpot } from './spot';

export interface GoldenSpot {
  id: string;
  hole: [Card, Card];
  board: Card[];
  opponents: number;
}

export interface ReferenceValue {
  id: string;
  equity: number;
  method: 'exact' | 'mc';
  /** Oracle sample count (mc) or null (exact). */
  samples: number | null;
  /** Oracle 95% half-width (mc) or null (exact). */
  halfWidth95: number | null;
}

export interface Reference {
  spots: GoldenSpot[];
  reference: { tool: string; version: string; command: string; seed: string; generatedAt: string; by: string };
  values: ReferenceValue[];
}

/** Oracle precision required for a Monte Carlo reference value: n >= 1e7 and half-width <= 0.03%p (SS20-AC1). */
export const ORACLE_MAX_HALF_WIDTH = 0.0003;
export const ORACLE_MIN_SAMPLES = 10_000_000;
/** Reference p below / above these leaves the Monte Carlo coverage set (edge_spots, RG1-L-03). */
export const EDGE_LOW = 0.02;
export const EDGE_HIGH = 0.98;

const CARD = /^[2-9TJQKA][shdc]$/;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCard = (v: unknown): v is Card => typeof v === 'string' && CARD.test(v);

function readSpot(v: unknown): GoldenSpot {
  if (!isRec(v) || typeof v.id !== 'string' || !Array.isArray(v.hole) || !Array.isArray(v.board) || !Number.isInteger(v.opponents)) {
    throw new Error(`golden: malformed spot ${JSON.stringify(v)}`);
  }
  const cards: unknown[] = [...(v.hole as unknown[]), ...(v.board as unknown[])];
  if (v.hole.length !== 2 || ![0, 3, 4, 5].includes(v.board.length) || !cards.every(isCard) || new Set(cards).size !== cards.length) {
    throw new Error(`golden: bad cards in ${v.id}`);
  }
  const n = v.opponents as number;
  if (n < 1 || n > 5) throw new Error(`golden: opponents out of 1..5 in ${v.id}`);
  return { id: v.id, hole: v.hole as [Card, Card], board: v.board as Card[], opponents: n };
}

function readValue(v: unknown): ReferenceValue {
  if (!isRec(v) || typeof v.id !== 'string' || typeof v.equity !== 'number' || v.equity < 0 || v.equity > 1) {
    throw new Error(`golden: malformed reference value ${JSON.stringify(v)}`);
  }
  if (v.method === 'exact' && v.samples === null && v.halfWidth95 === null) return { id: v.id, equity: v.equity, method: 'exact', samples: null, halfWidth95: null };
  if (v.method === 'mc' && typeof v.samples === 'number' && typeof v.halfWidth95 === 'number') {
    if (v.samples < ORACLE_MIN_SAMPLES || v.halfWidth95 > ORACLE_MAX_HALF_WIDTH) throw new Error(`golden: oracle precision too low for ${v.id}`);
    return { id: v.id, equity: v.equity, method: 'mc', samples: v.samples, halfWidth95: v.halfWidth95 };
  }
  throw new Error(`golden: reference value ${v.id} needs method exact (samples/halfWidth95 null) or mc (both numbers)`);
}

type Glob = (pattern: string, opts: { eager: true; import: 'default' }) => Record<string, unknown>;
// Vite's static glob (Vitest transforms it): picks up the optional reference file without Node fs types.
// ponytail: reads only equity-golden.json; when the lead adds a corrected version file (no regeneration in
// place), select the highest version here.
const FILES = (import.meta as unknown as { glob: Glob }).glob('../fixtures/equity-golden*.json', { eager: true, import: 'default' });

export function loadSpots(): GoldenSpot[] {
  const raw = FILES['../fixtures/equity-golden.spots.json'];
  if (!isRec(raw) || !Array.isArray(raw.spots)) throw new Error('golden: equity-golden.spots.json missing or malformed');
  const spots = (raw.spots as unknown[]).map(readSpot);
  if (new Set(spots.map((s) => s.id)).size !== spots.length) throw new Error('golden: duplicate spot id');
  return spots;
}

/** null until the lead commits the oracle file. */
export function loadReference(spots: GoldenSpot[]): Reference | null {
  const raw = FILES['../fixtures/equity-golden.json'];
  if (raw === undefined) return null;
  if (!isRec(raw) || !Array.isArray(raw.spots) || !Array.isArray(raw.values) || !isRec(raw.reference)) throw new Error('golden: equity-golden.json malformed');
  const r = raw.reference;
  const meta = ['tool', 'version', 'command', 'seed', 'generatedAt', 'by'] as const;
  if (!meta.every((k) => typeof r[k] === 'string' && (r[k] as string).length > 0)) throw new Error('golden: reference metadata must record tool, version, command, seed, generatedAt, by');
  const refSpots = (raw.spots as unknown[]).map(readSpot);
  // The reference must describe the same inputs: a drifted spot list would compare against the wrong position.
  const byId = new Map(spots.map((s) => [s.id, s]));
  for (const s of refSpots) {
    if (JSON.stringify(byId.get(s.id)) !== JSON.stringify(s)) throw new Error(`golden: reference spot ${s.id} differs from equity-golden.spots.json`);
  }
  const values = (raw.values as unknown[]).map(readValue);
  for (const v of values) if (!byId.has(v.id)) throw new Error(`golden: reference value for unknown spot ${v.id}`);
  return { spots: refSpots, reference: r as Reference['reference'], values };
}

/** FNV-1a 32-bit over UTF-16 code units (RG1-L-03 seed = fnv1a32(spotId)). */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function spotRng(spot: GoldenSpot): Rng {
  return createSeededRng(fnv1a32(spot.id));
}

/** A view with exactly `opponents` players still in, no price to call: equity depends on hole, board and N only. */
export function spotView(spot: GoldenSpot): MetricsView {
  return buildSpot(limpedSpot(spot.hole, spot.board, spot.opponents, false)).view;
}

export const isEdge = (p: number): boolean => p < EDGE_LOW || p > EDGE_HIGH;

/**
 * Edge-spot tolerance (lead review R0 3.2 m4): k binomial half-widths at the reference p for the estimate's own n,
 * plus 1/n so a reference at (or next to) 0 or 1 does not demand a perfect estimate. A flat 0.01 was ~10 sigma at
 * p = 0.01, n = 10,000 and let a 100% relative miss through — the edge is where rare-hand evaluator bugs show.
 */
export function edgeTolerance(pRef: number, n: number, k: number): number {
  return k * 1.96 * Math.sqrt((pRef * (1 - pRef)) / n) + 1 / n;
}

export interface Computed {
  spot: GoldenSpot;
  m: { value: number; method: 'exact' | 'mc'; samples: number | null; halfWidth95: number | null };
}

export interface Judgement {
  exact: number;
  /** Monte Carlo spots in the coverage set. */
  core: number;
  edge: number;
  pending: number;
  covered: number;
  coverage: number | null;
  maxExactErr: number;
  maxErr: number;
  maxRatio: number;
  /** Largest edge-spot |err| / edgeTolerance (<= 1 passes). */
  maxEdgeRatio: number;
  violations: string[];
}

/**
 * Applies golden_rule to whatever reference values exist. `k` = allowed |err| in half-widths (display 2, bot 3),
 * for coverage spots in the estimate's own half-widths and for edge spots in binomial half-widths at the reference
 * p (edgeTolerance). Coverage (>= 90%) and the >= 100 count are left to the caller.
 */
export function judge(computed: readonly Computed[], values: ReadonlyMap<string, ReferenceValue>, rule: { k: number }): Judgement {
  const violations: string[] = [];
  let exact = 0;
  let core = 0;
  let edge = 0;
  let covered = 0;
  let maxExactErr = 0;
  let maxErr = 0;
  let maxRatio = 0;
  let maxEdgeRatio = 0;
  for (const { spot, m } of computed) {
    const ref = values.get(spot.id);
    if (ref === undefined) continue;
    const err = Math.abs(m.value - ref.equity);
    if (m.method === 'exact') {
      exact += 1;
      maxExactErr = Math.max(maxExactErr, err);
      // An exact spot needs an exact reference: a sampled one cannot resolve 1e-6.
      if (ref.method !== 'exact') violations.push(`${spot.id}: exact spot with a sampled reference`);
      else if (err > 1e-6) violations.push(`${spot.id}: exact err ${err}`);
      continue;
    }
    const hw = m.halfWidth95 ?? 0;
    if (isEdge(ref.equity)) {
      edge += 1;
      // A Monte Carlo estimate always carries its sample count; a missing one is a fixture/metadata bug.
      if (m.samples === null) violations.push(`${spot.id}: mc spot without samples`);
      else {
        const tol = edgeTolerance(ref.equity, m.samples, rule.k);
        maxEdgeRatio = Math.max(maxEdgeRatio, err / tol);
        if (err > tol) violations.push(`${spot.id}: edge err ${err} > ${tol}`);
      }
      continue;
    }
    core += 1;
    if (err <= hw) covered += 1;
    maxErr = Math.max(maxErr, err);
    maxRatio = Math.max(maxRatio, hw > 0 ? err / hw : err > 0 ? Infinity : 0);
    if (err > rule.k * hw) violations.push(`${spot.id}: err ${err} > ${rule.k} x hw ${hw}`);
  }
  const pending = computed.filter((c) => !values.has(c.spot.id)).length;
  return { exact, core, edge, pending, covered, coverage: core > 0 ? covered / core : null, maxExactErr, maxErr, maxRatio, maxEdgeRatio, violations };
}

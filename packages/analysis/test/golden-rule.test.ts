// The golden pass rule itself (helpers/golden.ts judge) on synthetic values, so every branch of the comparison is
// checked independently of the oracle values. Also pins the per-spot seed function to the FNV-1a reference vectors.
import { describe, expect, it } from 'vitest';
import { edgeTolerance, fnv1a32, judge, type Computed, type ReferenceValue } from './helpers/golden';

const spot = (id: string): Computed['spot'] => ({ id, hole: ['As', 'Kd'], board: [], opponents: 1 });
const mc = (id: string, value: number, hw: number): Computed => ({ spot: spot(id), m: { value, method: 'mc', samples: 10_000, halfWidth95: hw } });
const ex = (id: string, value: number): Computed => ({ spot: spot(id), m: { value, method: 'exact', samples: null, halfWidth95: null } });
const ref = (id: string, equity: number, method: 'exact' | 'mc' = 'mc'): [string, ReferenceValue] => [
  id,
  method === 'exact' ? { id, equity, method, samples: null, halfWidth95: null } : { id, equity, method, samples: 1e7, halfWidth95: 0.0003 },
];

describe('golden rule judge', () => {
  it('counts coverage, keeps edge spots apart and reports pending', () => {
    const computed = [mc('a', 0.5, 0.01), mc('b', 0.515, 0.01), mc('c', 0.99, 0.002), ex('d', 0.25), mc('e', 0.3, 0.01)];
    const values = new Map([ref('a', 0.505), ref('b', 0.5), ref('c', 0.987), ref('d', 0.25, 'exact')]);
    const j = judge(computed, values, { k: 2 });
    expect(j).toMatchObject({ exact: 1, core: 2, edge: 1, pending: 1, covered: 1, coverage: 0.5, violations: [] });
    expect(j.maxRatio).toBeCloseTo(1.5, 12);
  });

  it('flags |err| > k half-widths, exact err > 1e-6, a sampled reference on an exact spot, edge err > tolerance', () => {
    const computed = [mc('a', 0.53, 0.01), ex('b', 0.25), ex('c', 0.25), mc('d', 0.995, 0.001)];
    const values = new Map([ref('a', 0.5), ref('b', 0.250002, 'exact'), ref('c', 0.25), ref('d', 0.984)]);
    const v = judge(computed, values, { k: 2 }).violations;
    expect(v).toHaveLength(4);
    expect(v.join('\n')).toMatch(/a: err .* > 2 x hw/);
    expect(v.join('\n')).toMatch(/b: exact err/);
    expect(v.join('\n')).toMatch(/c: exact spot with a sampled reference/);
    expect(v.join('\n')).toMatch(/d: edge err/);
    // The bot rule allows 3 half-widths: the same 3%p miss on a 1%p half-width is still out, 2.5%p is in.
    expect(judge([mc('a', 0.525, 0.01)], new Map([ref('a', 0.5)]), { k: 3 }).violations).toEqual([]);
  });

  // Lead review R0 3.2 m4: an edge spot (reference p < 0.02 or > 0.98) is held to the binomial half-width at the
  // reference p, k * 1.96 * sqrt(p(1-p)/n) + 1/n, not to a flat 0.01 / 0.031 that let a 100% relative miss pass.
  it('holds edge spots to k binomial half-widths at the reference p plus 1/n', () => {
    // n = 10,000, p = 0.01, k = 2: 3.92 * sqrt(0.0099 / 1e4) + 1e-4 = 0.0040003 (hand-computed).
    expect(edgeTolerance(0.01, 10_000, 2)).toBeCloseTo(0.0040003, 6);
    // n = 1,000, p = 0.99, k = 3: 5.88 * sqrt(0.0099 / 1e3) + 1e-3 = 0.0195008 (hand-computed).
    expect(edgeTolerance(0.99, 1000, 3)).toBeCloseTo(0.0195008, 6);
    // p = 0: the floor 1/n keeps a zero-variance reference from demanding a perfect estimate.
    expect(edgeTolerance(0, 10_000, 2)).toBe(1e-4);
    // 0.01 -> 0.02 (err 0.01) passed the old flat display tolerance; it is now out. 0.013 (err 0.003) is in.
    expect(judge([mc('x', 0.02, 0.0027)], new Map([ref('x', 0.01)]), { k: 2 }).violations).toEqual([expect.stringMatching(/^x: edge err/)]);
    expect(judge([mc('x', 0.013, 0.0022)], new Map([ref('x', 0.01)]), { k: 2 }).violations).toEqual([]);
    // Bot: 0.01 -> 0.035 at n = 1,000 (err 0.025 < 0.031 before) is out; 0.015 is in.
    const bot = (value: number): Computed => ({ spot: spot('y'), m: { value, method: 'mc', samples: 1000, halfWidth95: 0.008 } });
    expect(judge([bot(0.035)], new Map([ref('y', 0.01)]), { k: 3 }).violations).toEqual([expect.stringMatching(/^y: edge err/)]);
    expect(judge([bot(0.015)], new Map([ref('y', 0.01)]), { k: 3 }).violations).toEqual([]);
  });

  it('fnv1a32 matches the published FNV-1a 32-bit test vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

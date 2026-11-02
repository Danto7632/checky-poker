// Random number port and a deterministic seeded implementation (api.engine.v1 ports.Rng, R10).
//
// Production randomness comes from host/crypto-rng.ts (crypto.getRandomValues inside the Worker). The engine
// never reaches for a global source: everything that shuffles, picks an id or a bot delay receives an Rng.
// The seeded generator below is for tests and for the VITE_E2E `testSeed` path only.

/** The only randomness port. `nextUint32()` returns an integer in [0, 2^32). */
export interface Rng {
  nextUint32(): number;
}

const TWO_32 = 0x1_0000_0000;

/**
 * Uniform integer in [0, n) by rejection sampling, so no value is favoured when 2^32 is not a multiple of n
 * (a plain `x % n` biases small values; for a 52-card shuffle that bias is measurable over millions of hands).
 */
export function randomInt(rng: Rng, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || n > TWO_32) throw new RangeError('randomInt: n out of range');
  const limit = TWO_32 - (TWO_32 % n);
  for (;;) {
    const x = rng.nextUint32();
    if (x < limit) return x % n;
  }
}

/** FNV-1a 32-bit over the UTF-16 code units of a string. Used only to turn a seed string into a number. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic generator (xoshiro128**, state expanded from the seed with splitmix32).
 * Same seed, same sequence, on every JS engine. Not for production shuffles.
 */
export function createSeededRng(seed: string | number): Rng {
  let x = (typeof seed === 'number' ? seed : fnv1a32(seed)) >>> 0;
  const splitmix = (): number => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = splitmix();
  let b = splitmix();
  let c = splitmix();
  let d = splitmix();
  // xoshiro must not start from the all-zero state.
  if ((a | b | c | d) === 0) a = 1;
  return {
    nextUint32(): number {
      const result = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
      const t = (b << 9) >>> 0;
      c ^= a;
      d ^= b;
      b ^= c;
      a ^= d;
      c ^= t;
      d = rotl(d, 11);
      a >>>= 0;
      b >>>= 0;
      c >>>= 0;
      return result;
    },
  };
}

function rotl(v: number, k: number): number {
  return ((v << k) | (v >>> (32 - k))) >>> 0;
}

// Cryptographic randomness for the host Worker: shuffles, handIds, bot thinking delays (R10) and the per-hand
// seal pad (ADR-0003). One of the four files allowed to call crypto.getRandomValues (code-structure section 5).
// getRandomValues fills at most 65,536 bytes per call (QuotaExceededError above), so larger requests are chunked.
import type { Rng } from '@checky/engine/util';

const MAX_PER_CALL = 65536;

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('randomBytes: n must be a non-negative integer');
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += MAX_PER_CALL) crypto.getRandomValues(out.subarray(off, Math.min(n, off + MAX_PER_CALL)));
  return out;
}

/** Rng over getRandomValues, buffered 256 words at a time to keep the shuffle cheap. */
export function createCryptoRng(): Rng {
  const buf = new Uint32Array(256);
  let i = buf.length;
  return {
    nextUint32(): number {
      if (i === buf.length) {
        crypto.getRandomValues(buf);
        i = 0;
      }
      return buf[i++]!;
    },
  };
}

// Random identifiers drawn from the injected Rng (never a global source, I-9).
//
// randomId(rng, 16) is the handId format: 128 random bits as 22 base64url characters (HandView.handId).
import { base64urlEncode } from './base64url';
import type { Rng } from './rng';

export function randomBytesFrom(rng: Rng, count: number): Uint8Array {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i += 4) {
    const x = rng.nextUint32();
    out[i] = x & 0xff;
    if (i + 1 < count) out[i + 1] = (x >>> 8) & 0xff;
    if (i + 2 < count) out[i + 2] = (x >>> 16) & 0xff;
    if (i + 3 < count) out[i + 3] = (x >>> 24) & 0xff;
  }
  return out;
}

export function randomId(rng: Rng, bytes: number): string {
  return base64urlEncode(randomBytesFrom(rng, bytes));
}

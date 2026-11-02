// Cryptographic Rng for the metrics Worker's Monte Carlo samples. One of the four files allowed to call
// crypto.getRandomValues (code-structure section 5, D-S6). Values are drawn 1,024 at a time because a display
// estimate needs ~10^5 draws and one getRandomValues call per draw would dominate the budget.
import type { Rng } from '@checky/engine/util';

export function createCryptoRng(): Rng {
  const buf = new Uint32Array(1024);
  let i = buf.length;
  return {
    nextUint32(): number {
      if (i === buf.length) {
        crypto.getRandomValues(buf);
        i = 0;
      }
      const v = buf[i]!;
      i += 1;
      return v;
    },
  };
}

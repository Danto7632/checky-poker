// Per-hand XOR sealing of the Worker's private state (ADR-0003 option B). Between reducer calls the hand
// (deck, every hole card) and the bots' private memory exist only as `blob = UTF-8(JSON) XOR pad`; the plain
// object lives for one reducer call. This is not encryption against a determined host with a debugger (D6
// accepts that) — it keeps card data out of anything a casual look at Worker memory, a heap string search or a
// stray log would show. Cards are integers 0..51, so the plaintext holds no card-shaped strings either.
//
// A new pad is drawn for every hand (and a bigger one if the state ever outgrows 64 KiB). The pad comes from
// crypto-rng's randomBytes — this file never calls getRandomValues itself (lint: 4 allowed files, T2-010).
import { utf8Decode, utf8Encode } from '@checky/engine/util';

export const PAD_BYTES = 65536;

export interface Sealer {
  /** Seal `value` for `handKey`; a different handKey than last time draws a fresh pad. */
  seal(value: unknown, handKey: string): Uint8Array;
  unseal(blob: Uint8Array): unknown;
}

function xor(data: Uint8Array, pad: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) out[i] = data[i]! ^ pad[i]!;
  return out;
}

export function createSealer(randomBytes: (n: number) => Uint8Array): Sealer {
  let pad: Uint8Array | null = null;
  let padKey: string | null = null;
  return {
    seal(value, handKey) {
      const plain = utf8Encode(JSON.stringify(value));
      if (pad === null || padKey !== handKey || plain.length > pad.length) {
        let size = PAD_BYTES;
        while (size < plain.length) size *= 2;
        pad = randomBytes(size);
        padKey = handKey;
      }
      return xor(plain, pad);
    },
    unseal(blob) {
      if (pad === null || blob.length > pad.length) throw new RangeError('unseal: no pad for this blob');
      const parsed: unknown = JSON.parse(utf8Decode(xor(blob, pad)));
      return parsed;
    },
  };
}

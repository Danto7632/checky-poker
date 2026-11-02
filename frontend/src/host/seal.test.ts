// AC-10 sealing checks (ADR-0003 deterministic checks, S11-F04/RL-09): round trip, no card text in the plaintext,
// no plaintext field names in the blob, a new pad per hand. No card-regex search over the blob (random bytes
// would match ~3 times per 4 KB — the check ADR-0003 replaced).
import { describe, expect, it } from 'vitest';
import { createHand } from '@checky/engine';
import { createSeededRng } from '@checky/engine/util';
import { PAD_BYTES, createSealer } from './seal';
import { createCryptoRng, randomBytes } from './crypto-rng';

const hand = (seed: string) =>
  createHand({ handId: `h-${seed}`.padEnd(22, 'x'), seats: [0, 1, 2, 3, 4, 5].map((seat) => ({ seat, stack: 10000 })), buttonSeat: 0, sb: 50, bb: 100 }, createSeededRng(seed));

describe('seal', () => {
  it('unseal(seal(x)) === x', () => {
    const sealer = createSealer(randomBytes);
    const payload = { hand: hand('a'), memory: { 3: [{ street: 'PREFLOP', action: 'call', amount: 100, thought: 'ok' }] } };
    expect(sealer.unseal(sealer.seal(payload, 'h-a'))).toEqual(payload);
  });

  it('the plaintext before sealing has no card strings: cards are integers 0..51', () => {
    const text = JSON.stringify({ hand: hand('b'), memory: {} });
    expect(text.match(/"[2-9TJQKA][shdc]"/g)).toBeNull();
    expect(text).toMatch(/"hole":\[\d+,\d+\]/);
  });

  it('the blob holds none of the plaintext field names', () => {
    const sealer = createSealer(randomBytes);
    const blob = sealer.seal({ hand: hand('c'), memory: {} }, 'h-c');
    const ascii = String.fromCharCode(...blob);
    for (const name of ['hole', 'deck', 'board', 'seats', 'actions', 'handId', 'memory', 'stack']) expect(ascii).not.toContain(name);
  });

  it('every hand gets a fresh pad; the same hand keeps its pad; oversized state gets a bigger pad', () => {
    const pads: Uint8Array[] = [];
    const sealer = createSealer((n) => {
      const p = randomBytes(n);
      pads.push(p);
      return p;
    });
    const same = { hand: hand('d'), memory: {} };
    const b1 = sealer.seal(same, 'hand-1');
    const b2 = sealer.seal(same, 'hand-1');
    expect(pads).toHaveLength(1);
    expect(b2).toEqual(b1);
    const b3 = sealer.seal(same, 'hand-2');
    expect(pads).toHaveLength(2);
    expect(pads[1]).not.toEqual(pads[0]);
    expect(b3).not.toEqual(b1);
    expect(pads[0]).toHaveLength(PAD_BYTES);
    sealer.seal({ big: 'x'.repeat(PAD_BYTES + 10) }, 'hand-2');
    expect(pads.at(-1)!.length).toBe(PAD_BYTES * 2);
  });

  it('randomBytes chunks requests above the 65,536-byte getRandomValues limit; the crypto rng is in range', () => {
    const big = randomBytes(200_000);
    expect(big).toHaveLength(200_000);
    expect(big.subarray(150_000).some((b) => b !== 0)).toBe(true);
    const rng = createCryptoRng();
    for (let i = 0; i < 1000; i += 1) {
      const x = rng.nextUint32();
      expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
    }
  });
});

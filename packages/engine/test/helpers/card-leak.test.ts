// Self-test of the shared card-leak checker: it must catch real leaks and stay quiet on random ids (T-006).
import { describe, expect, it } from 'vitest';
import { createSeededRng, randomId } from '../../src/util';
import { DEFAULT_SKIP_KEYS, collectCardLeaks } from './card-leak';

describe('collectCardLeaks', () => {
  it('flags a card in a card field that is not allowed (structure pass)', () => {
    const leaks = collectCardLeaks({ me: { holeCards: ['As', 'Kd'] } }, new Set(['As']));
    expect(leaks.filter((l) => l.via === 'field')).toEqual([{ path: '$.me.holeCards[1]', card: 'Kd', via: 'field' }]);
  });

  it('flags a card hidden in a non-card field (token pass)', () => {
    const leaks = collectCardLeaks({ debug: 'Th' }, new Set());
    expect(leaks).toEqual([{ path: '$', card: 'Th', via: 'token' }]);
  });

  it('reports nothing when every card is allowed', () => {
    expect(collectCardLeaks({ board: ['2c', '7d', 'Qs'], result: { showdown: [{ cards: ['Ah', 'Ad'] }] } }, new Set(['2c', '7d', 'Qs', 'Ah', 'Ad']))).toEqual([]);
  });

  it('has 0 false positives on 1,000 random 22-char base64url handIds', () => {
    const rng = createSeededRng('card-leak-handIds');
    const ids = Array.from({ length: 1000 }, () => ({ handId: randomId(rng, 16), other: randomId(rng, 16) }));
    // `other` is not a skipped key: the token pass still ignores it because it is never an exact 2-char string.
    expect(collectCardLeaks(ids, new Set())).toEqual([]);
  });

  it('a "Kd" nickname is not a card field: no structure hit, and no token hit once name is skipped', () => {
    const v = { seats: [{ occupant: { name: 'Kd', inHand: { cards: null } } }] };
    expect(collectCardLeaks(v, new Set()).filter((l) => l.via === 'field')).toEqual([]);
    expect(collectCardLeaks(v, new Set(), { skipKeys: [...DEFAULT_SKIP_KEYS, 'name'] })).toEqual([]);
  });

  it('skips base64url keys before the token pass', () => {
    expect(collectCardLeaks({ sig: 'As', n: 'Kd' }, new Set())).toEqual([]);
  });
});

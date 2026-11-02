// Shared card-leak checker for tests (T-006, Q-006, Q-019). 2-1, 3-1 and 3-2 tests import it read-only.
//
// Two independent passes, both must find nothing outside `allowed`:
//   1. structure: walk the value and read every card-typed field (holeCards, cards, board, best5) — catches a
//      card that was put where cards belong but should not be visible;
//   2. tokens: JSON.stringify the value and search for EXACT quoted two-character card tokens such as "As" —
//      catches a card hidden in some other field (a debug string, an error message...).
// The token pass never matches inside a longer string, so random base64url (handId, nonces, signatures) does
// not produce false positives; keys listed in `skipKeys` are removed before stringifying. A fixture that uses a
// card-shaped nickname ('Kd') must add 'name' to skipKeys — better: do not use card-shaped names.
//
//   collectCardLeaks({me: {holeCards: ['As', 'Kd']}}, new Set(['As']))
//   -> [{ path: '$.me.holeCards[1]', card: 'Kd', via: 'field' }, { path: '$', card: 'Kd', via: 'token' }]
export const CARD_FIELD_KEYS = ['holeCards', 'cards', 'board', 'best5'] as const;
export const DEFAULT_SKIP_KEYS = ['handId', 'n', 'pub', 'sig', 'nonce'] as const;

const CARD_RE = /^[2-9TJQKA][shdc]$/;
const TOKEN_RE = /"([2-9TJQKA][shdc])"/g;

export interface CardLeak {
  path: string;
  card: string;
  via: 'field' | 'token';
}

export function collectCardLeaks(
  value: unknown,
  allowed: ReadonlySet<string>,
  opts: { skipKeys?: readonly string[] } = {},
): CardLeak[] {
  const skip = new Set<string>(opts.skipKeys ?? DEFAULT_SKIP_KEYS);
  const leaks: CardLeak[] = [];

  const walk = (v: unknown, path: string, inCardField: boolean): void => {
    if (typeof v === 'string') {
      if (inCardField && CARD_RE.test(v) && !allowed.has(v)) leaks.push({ path, card: v, via: 'field' });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, inCardField));
      return;
    }
    if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if (skip.has(k)) continue;
        walk(x, `${path}.${k}`, (CARD_FIELD_KEYS as readonly string[]).includes(k));
      }
    }
  };
  walk(value, '$', false);

  const text = JSON.stringify(value, (k, x: unknown) => (k !== '' && skip.has(k) ? undefined : x));
  if (text !== undefined) {
    for (const m of text.matchAll(TOKEN_RE)) {
      const card = m[1]!;
      if (!allowed.has(card)) leaks.push({ path: '$', card, via: 'token' });
    }
  }
  return leaks;
}

/** Every card string found in card-typed fields (handy to build `allowed` sets in tests). */
export function cardsInFields(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, inCardField: boolean): void => {
    if (typeof v === 'string') {
      if (inCardField && CARD_RE.test(v)) out.add(v);
    } else if (Array.isArray(v)) {
      v.forEach((x) => walk(x, inCardField));
    } else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) walk(x, (CARD_FIELD_KEYS as readonly string[]).includes(k));
    }
  };
  walk(value, false);
  return out;
}

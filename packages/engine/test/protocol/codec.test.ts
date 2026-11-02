// AC-10 (C15): strict UTF-8, the wire codec, and validateEnvelope (incl. US7 AC6: host commands are not messages).
import { describe, expect, it } from 'vitest';
import { decodeEnvelope, encodeEnvelope } from '../../src/protocol/codec';
import { envelope } from '../../src/protocol/envelope';
import type { HostCommand } from '../../src/protocol/messages';
import { MAX_ENVELOPE_BYTES, isHostCommand, validateEnvelope } from '../../src/protocol/validate';
import { CheckyError } from '../../src/util/checky-error';
import { utf8Decode, utf8Encode } from '../../src/util/utf8';
import { base64urlDecode, base64urlEncode } from '../../src/util/base64url';
import { createSeededRng } from '../../src/util/rng';
import { randomBytesFrom, randomId } from '../../src/util/ids';

const errCode = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof CheckyError ? e.code : `other:${String(e)}`;
  }
};

describe('utf8 (strict)', () => {
  it.each([
    ['ASCII', 'Hello, table 7'],
    ['Japanese nickname (3-byte)', 'ミナ・けんじ'],
    ['emoji (4-byte)', 'GG 😀🂡'],
    ['mixed', 'aé€\u{1F600}z'],
  ])('round-trips %s', (_n, text) => {
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('encodes code points with the expected byte lengths', () => {
    expect(utf8Encode('a')).toEqual(new Uint8Array([0x61]));
    expect(utf8Encode('é')).toHaveLength(2);
    expect(utf8Encode('ミ')).toHaveLength(3);
    expect(utf8Encode('😀')).toEqual(new Uint8Array([0xf0, 0x9f, 0x98, 0x80]));
  });

  it.each([
    ['stray continuation', [0x80]],
    ['bad continuation', [0xc3, 0x28]],
    ['overlong NUL (C0 80)', [0xc0, 0x80]],
    ['overlong 3-byte (E0 80 80)', [0xe0, 0x80, 0x80]],
    ['overlong 4-byte (F0 80 80 80)', [0xf0, 0x80, 0x80, 0x80]],
    ['UTF-16 surrogate (ED A0 80)', [0xed, 0xa0, 0x80]],
    ['above U+10FFFF (F4 90 80 80)', [0xf4, 0x90, 0x80, 0x80]],
    ['F5 lead', [0xf5, 0x80, 0x80, 0x80]],
    ['truncated 2-byte', [0xc3]],
    ['truncated 4-byte', [0xf0, 0x9f, 0x98]],
  ])('rejects %s with E-PROTO-MALFORMED', (_n, bytes) => {
    expect(errCode(() => utf8Decode(new Uint8Array(bytes)))).toBe('E-PROTO-MALFORMED');
  });

  it('rejects lone surrogates on encode', () => {
    expect(errCode(() => utf8Encode('\ud800'))).toBe('E-PROTO-MALFORMED');
    expect(errCode(() => utf8Encode('a\udc00b'))).toBe('E-PROTO-MALFORMED');
  });

  it('decodes long texts (chunked String.fromCharCode)', () => {
    const long = 'あ'.repeat(30000);
    expect(utf8Decode(utf8Encode(long))).toBe(long);
  });
});

describe('base64url and ids', () => {
  it('round-trips every length 0..40 and rejects bad input', () => {
    const rng = createSeededRng('b64');
    for (let n = 0; n <= 40; n += 1) {
      const bytes = randomBytesFrom(rng, n);
      const text = base64urlEncode(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(base64urlDecode(text)).toEqual(bytes);
    }
    expect(() => base64urlDecode('abc=')).toThrow(RangeError);
    expect(() => base64urlDecode('a')).toThrow(RangeError);
  });
  it('randomId(rng, 16) is a 22-char handId', () => {
    expect(randomId(createSeededRng(1), 16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('encodeEnvelope / decodeEnvelope', () => {
  const env = envelope('H.ACK', 3, { c: 7 });
  it('encodes UTF-8 JSON without whitespace; first byte is always 0x7B', () => {
    const bytes = encodeEnvelope(env);
    expect(bytes[0]).toBe(0x7b);
    expect(utf8Decode(bytes)).toBe('{"v":1,"t":"H.ACK","s":3,"b":{"c":7}}');
    expect(decodeEnvelope(bytes)).toEqual(env);
  });
  it('rejects another first byte, invalid UTF-8 and broken JSON with E-PROTO-MALFORMED', () => {
    expect(errCode(() => decodeEnvelope(new Uint8Array([0x5b, 0x5d])))).toBe('E-PROTO-MALFORMED');
    expect(errCode(() => decodeEnvelope(new Uint8Array([])))).toBe('E-PROTO-MALFORMED');
    expect(errCode(() => decodeEnvelope(new Uint8Array([0x7b, 0xc0, 0x80, 0x7d])))).toBe('E-PROTO-MALFORMED');
    expect(errCode(() => decodeEnvelope(utf8Encode('{"v":1,')))).toBe('E-PROTO-MALFORMED');
  });
  it('round-trips Japanese and emoji chat text', () => {
    const chat = envelope('G.CHAT', 1, { text: 'よろしく😀' });
    expect(decodeEnvelope(encodeEnvelope(chat))).toEqual(chat);
  });
});

describe('validateEnvelope', () => {
  it('accepts well-formed messages for the right direction', () => {
    expect(validateEnvelope({ v: 1, t: 'G.ACT', s: 4, b: { handId: 'h', turnSeq: 3, action: { seat: 1, type: 'raise', to: 300 } } }, 'to_host').t).toBe('G.ACT');
    expect(validateEnvelope({ v: 1, t: 'G.REFILL', s: 1, b: {} }, 'to_host').t).toBe('G.REFILL');
    expect(validateEnvelope({ v: 1, t: 'H.NACK', s: 9, b: { c: 4, code: 'E-ACT-AMOUNT' } }, 'to_guest').t).toBe('H.NACK');
  });

  it('host commands are not P2P messages: G.PAUSE / G.START / G.KICK -> E-PROTO-UNKNOWN-TYPE (US7 AC6)', () => {
    for (const t of ['G.PAUSE', 'G.START', 'G.KICK', 'G.ADD_BOT', 'G.LOCK', 'W.CMD']) {
      expect(errCode(() => validateEnvelope({ v: 1, t, s: 1, b: {} }, 'to_host'))).toBe('E-PROTO-UNKNOWN-TYPE');
    }
  });

  it('wrong direction is an unknown type', () => {
    expect(errCode(() => validateEnvelope({ v: 1, t: 'H.ACK', s: 1, b: { c: 1 } }, 'to_host'))).toBe('E-PROTO-UNKNOWN-TYPE');
    expect(errCode(() => validateEnvelope({ v: 1, t: 'G.HB', s: 1, b: {} }, 'to_guest'))).toBe('E-PROTO-UNKNOWN-TYPE');
  });

  it.each([
    ['not an object', 'x'],
    ['array', []],
    ['wrong v', { v: 2, t: 'G.HB', s: 1, b: {} }],
    ['negative s', { v: 1, t: 'G.HB', s: -1, b: {} }],
    ['extra envelope key', { v: 1, t: 'G.HB', s: 1, b: {}, x: 1 }],
    ['extra body key', { v: 1, t: 'G.HB', s: 1, b: { x: 1 } }],
    ['bad action type', { v: 1, t: 'G.ACT', s: 1, b: { handId: 'h', turnSeq: 1, action: { seat: 0, type: 'callany' } } }],
    ['float amount', { v: 1, t: 'G.ACT', s: 1, b: { handId: 'h', turnSeq: 1, action: { seat: 0, type: 'bet', to: 1.5 } } }],
    ['unknown error code', { v: 1, t: 'H.NACK', s: 1, b: { c: 1, code: 'E-NOPE' } }],
  ])('rejects %s with E-PROTO-MALFORMED', (_n, raw) => {
    expect(errCode(() => validateEnvelope(raw, 'to_host'))).toMatch(/E-PROTO-(MALFORMED|UNKNOWN-TYPE)/);
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw) && 'v' in raw) {
      expect(errCode(() => validateEnvelope(raw, (raw as { t: string }).t.startsWith('H.') ? 'to_guest' : 'to_host'))).toBe('E-PROTO-MALFORMED');
    }
  });

  it('rejects an own "__proto__" key from JSON.parse (no prototype smuggling)', () => {
    // Built inline: it.each copies its arguments and would drop the own __proto__ key.
    const raw: unknown = JSON.parse('{"v":1,"t":"G.HB","s":1,"b":{"__proto__":{"x":1}}}');
    expect(errCode(() => validateEnvelope(raw, 'to_host'))).toBe('E-PROTO-MALFORMED');
  });

  it('rejects an envelope larger than 65,536 bytes with E-PROTO-TOO-LARGE', () => {
    expect(MAX_ENVELOPE_BYTES).toBe(65536);
    const raw = { v: 1, t: 'G.CHAT', s: 1, b: { text: 'x'.repeat(70000) } };
    expect(errCode(() => validateEnvelope(raw, 'to_host'))).toBe('E-PROTO-TOO-LARGE');
  });
});

// R0 m3: the Worker shell drops a W.CMD whose command does not have the HostCommand shape (E-PROTO-MALFORMED).
describe('isHostCommand', () => {
  const bot = { engine: 'rule', style: 'balanced', provider: null, model: null, label: 'Ada' } as const;
  const valid: HostCommand[] = [
    { t: 'START' },
    { t: 'PAUSE' },
    { t: 'RESUME' },
    { t: 'CLOSE', mode: 'after_hand' },
    { t: 'CLOSE', mode: 'now' },
    { t: 'LOCK', on: true },
    { t: 'KICK', seat: 1 },
    { t: 'SET_BLINDS', sb: 100, bb: 200 },
    { t: 'SET_OPTION' },
    { t: 'SET_OPTION', liveEquity: false, botChatter: true },
    { t: 'ADD_BOT', seat: null, bot },
    { t: 'ADD_BOT', seat: 3, bot: { ...bot, engine: 'llm', provider: 'openai', model: 'gpt' } },
    { t: 'UPDATE_BOT', seat: 3, bot },
    { t: 'REMOVE_BOT', seat: 3 },
    { t: 'ACT', handId: 'h1', turnSeq: 4, action: { seat: 0, type: 'call' } },
    { t: 'ACT', handId: 'h1', turnSeq: 4, action: { seat: 0, type: 'raise', to: 900 } },
    { t: 'SIT', mode: 'out' },
    { t: 'SIT', mode: 'in' },
    { t: 'REFILL' },
    { t: 'CHAT', text: 'hi' },
  ];
  it.each(valid.map((c) => [JSON.stringify(c), c]))('accepts %s', (_, c) => {
    expect(isHostCommand(c)).toBe(true);
  });
  const invalid: unknown[] = [
    null,
    'START',
    [],
    {},
    { t: 'NOPE' },
    { t: 'toString' },
    { t: 'START', x: 1 },
    { t: 'ACT' },
    { t: 'ACT', handId: 'h1', turnSeq: 4 },
    { t: 'ACT', handId: 'h1', turnSeq: -1, action: { seat: 0, type: 'call' } },
    { t: 'ACT', handId: 'h1', turnSeq: 4, action: { seat: 9, type: 'call' } },
    { t: 'ACT', handId: 'h1', turnSeq: 4, action: { seat: 0, type: 'post_bb' } },
    { t: 'ADD_BOT', seat: null },
    { t: 'ADD_BOT', seat: null, bot: { ...bot, key: 'sk-x' } },
    { t: 'CLOSE', mode: 'later' },
    { t: 'SIT' },
    { t: 'SET_OPTION', liveEquity: 'yes' },
    { t: 'CHAT', text: 5 },
  ];
  it.each(invalid.map((c) => [JSON.stringify(c), c]))('rejects %s', (_, c) => {
    expect(isHostCommand(c)).toBe(false);
  });
  it('rejects an own "__proto__" key', () => {
    expect(isHostCommand(JSON.parse('{"t":"REFILL","__proto__":{"x":1}}'))).toBe(false);
  });
});

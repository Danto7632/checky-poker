// Strict UTF-8 encode/decode as pure functions (A-PROTO-CODEC). The engine compiles with lib ES2023 and
// types [], so TextEncoder/TextDecoder do not exist here; the codec needs a decoder that REJECTS bad input
// instead of replacing it with U+FFFD, because a guest must drop a malformed frame (E-PROTO-MALFORMED) rather
// than act on a silently altered one.
//
// Rejected on decode: stray continuation bytes, overlong forms (e.g. C0 80), UTF-16 surrogates encoded as
// UTF-8 (ED A0 80..ED BF BF), code points above U+10FFFF, truncated sequences.
// Rejected on encode: lone surrogates (JSON.stringify escapes them, so encodeEnvelope never sees one).
import { CheckyError } from './checky-error';

function malformed(): never {
  throw new CheckyError('E-PROTO-MALFORMED');
}

export function utf8Encode(text: string): Uint8Array<ArrayBuffer> {
  // Worst case 3 bytes per UTF-16 code unit (a surrogate pair is 2 units -> 4 bytes).
  const buf = new Uint8Array(text.length * 3);
  let o = 0;
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdfff) {
      const next = text.charCodeAt(i + 1);
      if (cp > 0xdbff || !(next >= 0xdc00 && next <= 0xdfff)) malformed();
      cp = 0x10000 + ((cp - 0xd800) << 10) + (next - 0xdc00);
      i += 1;
    }
    if (cp < 0x80) {
      buf[o++] = cp;
    } else if (cp < 0x800) {
      buf[o++] = 0xc0 | (cp >> 6);
      buf[o++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      buf[o++] = 0xe0 | (cp >> 12);
      buf[o++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[o++] = 0x80 | (cp & 0x3f);
    } else {
      buf[o++] = 0xf0 | (cp >> 18);
      buf[o++] = 0x80 | ((cp >> 12) & 0x3f);
      buf[o++] = 0x80 | ((cp >> 6) & 0x3f);
      buf[o++] = 0x80 | (cp & 0x3f);
    }
  }
  return buf.slice(0, o);
}

export function utf8Decode(bytes: Uint8Array): string {
  const units: number[] = [];
  let out = '';
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b0 = bytes[i]!;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      cp = ((b0 & 0x1f) << 6) | cont(bytes, i + 1);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      const b1 = bytes[i + 1];
      // E0 needs A0..BF (else overlong), ED needs 80..9F (else a surrogate).
      if (b1 === undefined || (b0 === 0xe0 && b1 < 0xa0) || (b0 === 0xed && b1 > 0x9f)) malformed();
      cp = ((b0 & 0x0f) << 12) | (cont(bytes, i + 1) << 6) | cont(bytes, i + 2);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      const b1 = bytes[i + 1];
      // F0 needs 90..BF (else overlong), F4 needs 80..8F (else above U+10FFFF).
      if (b1 === undefined || (b0 === 0xf0 && b1 < 0x90) || (b0 === 0xf4 && b1 > 0x8f)) malformed();
      cp = ((b0 & 0x07) << 18) | (cont(bytes, i + 1) << 12) | (cont(bytes, i + 2) << 6) | cont(bytes, i + 3);
      i += 4;
    } else {
      // 80..C1 (stray continuation or overlong 2-byte lead) and F5..FF never start a valid sequence.
      malformed();
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      units.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else {
      units.push(cp);
    }
    // Flush in chunks: String.fromCharCode(...units) has an argument-count limit.
    if (units.length >= 4096) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  return out + String.fromCharCode(...units);
}

/** The low 6 bits of a continuation byte at `i`; throws if it is missing or not 10xxxxxx. */
function cont(bytes: Uint8Array, i: number): number {
  const b = bytes[i];
  if (b === undefined || (b & 0xc0) !== 0x80) malformed();
  return b & 0x3f;
}

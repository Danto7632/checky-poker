// A-PROTO-CODEC: the wire format (protocol.p2p.v1 wire_format, D29).
//
//   bytes = UTF-8(JSON.stringify(Envelope))   no whitespace, so byte 0 is always 0x7B '{'
//
// Bytes 0x00..0x7A as a first byte are reserved for future frame formats (e.g. an encrypted frame) and are
// rejected today. decode returns `unknown`: only validateEnvelope may turn it into an Envelope. The size limit
// (65,536 B) is checked by the CALLER before decoding (D29), so a huge frame is never even parsed.
import { CheckyError } from '../util/checky-error';
import { utf8Decode, utf8Encode } from '../util/utf8';
import type { Envelope } from './messages';

const OPEN_BRACE = 0x7b;

export function encodeEnvelope(env: Envelope): Uint8Array<ArrayBuffer> {
  return utf8Encode(JSON.stringify(env));
}

/** Throws CheckyError('E-PROTO-MALFORMED') on a wrong first byte, invalid UTF-8 or invalid JSON. */
export function decodeEnvelope(bytes: Uint8Array): unknown {
  if (bytes.length === 0 || bytes[0] !== OPEN_BRACE) throw new CheckyError('E-PROTO-MALFORMED');
  const text = utf8Decode(bytes);
  try {
    const raw: unknown = JSON.parse(text);
    return raw;
  } catch {
    // No `cause`: V8's SyntaxError message quotes part of the input, which may hold a guest's own cards.
    throw new CheckyError('E-PROTO-MALFORMED');
  }
}

// Envelope construction helper. Senders always build envelopes through `envelope()` so `v` is never forgotten
// and the body type is checked against MessageBodies for the given `t`.
import { ENVELOPE_VERSION, type Envelope, type MessageBodies, type MessageType } from './messages';

export function envelope<T extends MessageType>(t: T, s: number, b: MessageBodies[T]): Envelope<T> {
  return { v: ENVELOPE_VERSION, t, s, b } as Envelope<T>;
}

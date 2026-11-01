// Lint fixture: MessageEvent.data is any and must not be assigned to a typed Envelope.
type Envelope = { readonly v: 1 };
declare const ev: MessageEvent;

export const e: Envelope = ev.data;

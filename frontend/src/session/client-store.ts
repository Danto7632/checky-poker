// The client snapshot store and applyEnvelope (api.session.v1 behaviour, ADR-0007). Every client kind reflects
// H.* through this one function — guests from decoded bytes, host/practice/arena from the Worker's W.OUT local.
//
// Ordering: an envelope with s <= the last applied s is dropped (duplicate or late); a gap is accepted, because
// every H.VIEW is a full snapshot, so a lost message never accumulates. The snapshot is immutable and replaced
// only when something changed, which is what useSyncExternalStore needs (same reference = no re-render).
import type { Envelope } from '@checky/engine/protocol';
import type { ClientSnapshot } from './types';

const CHAT_KEEP = 100;
const NOTICES_KEEP = 20;

export interface ClientStore {
  getSnapshot(): ClientSnapshot;
  subscribe(listener: () => void): () => void;
  /** Apply one validated envelope. Returns true when the snapshot changed. */
  applyEnvelope(env: Envelope): boolean;
  /** Replace parts of the snapshot (connection stage, alert...). */
  patch(fn: (s: ClientSnapshot) => ClientSnapshot): void;
}

export function initialSnapshot(stage: ClientSnapshot['conn']['stage']): ClientSnapshot {
  return {
    conn: { stage, error: null, hostLost: null, reconnecting: false, hostTab: false },
    view: null,
    chat: [],
    notices: [],
    host: null,
    closed: null,
    alert: null,
  };
}

export function createClientStore(initial: ClientSnapshot, now: () => number): ClientStore {
  let snap = initial;
  let lastS = -1;
  const listeners = new Set<() => void>();
  const set = (next: ClientSnapshot): void => {
    if (next === snap) return;
    snap = next;
    for (const l of [...listeners]) l();
  };
  return {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyEnvelope(env) {
      if (env.s <= lastS) return false;
      lastS = env.s;
      const before = snap;
      switch (env.t) {
        case 'H.VIEW': {
          const view = env.b.view;
          const prevHand = snap.view?.hand?.handId ?? null;
          const nextHand = view.hand?.handId ?? null;
          // A new hand clears a non-fatal alert (S11-F12): the voided hand is behind us.
          const newHand = nextHand !== null && nextHand !== prevHand && view.hand?.street !== 'VOIDED';
          set({ ...snap, view, alert: newHand ? null : snap.alert });
          break;
        }
        case 'H.CHAT':
          set({ ...snap, chat: [...snap.chat, { ...env.b.line, atMs: now() }].slice(-CHAT_KEEP) });
          break;
        case 'H.NOTICE':
          set({ ...snap, notices: [...snap.notices, { code: env.b.code, p: env.b.p, atMs: now() }].slice(-NOTICES_KEEP) });
          break;
        case 'H.CLOSED':
          set({ ...snap, closed: env.b.summary, conn: { ...snap.conn, stage: 'closed' } });
          break;
        default:
          // H.ACK/H.NACK are consumed by the client before reaching the store; H.PROOF/WELCOME/REJECT/HB are 2-1.
          break;
      }
      return snap !== before;
    },
    patch(fn) {
      set(fn(snap));
    },
  };
}

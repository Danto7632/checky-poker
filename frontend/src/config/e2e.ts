import type { Defaults } from './defaults';

// E2E hook object (api.config.v1 e2e_hooks). Owners: dv = lead (defaults.ts), testSeed/relays/tap = Phillip,
// llm = Andrew. The object is only read when VITE_E2E === 'true'; release builds reduce this to `return null`.
export interface E2EHooks {
  dv?: Partial<Defaults>;
  testSeed?: string;
  /** Opaque to config (config must not import ai types); Andrew's composition passes it to createMockDecider. */
  llm?: Readonly<Record<string, unknown>> | null;
  relays?: { nostr: string[]; mqtt: string[] } | null;
  /**
   * true = the dev ring of 20 frames. {max?} = the E2E full-capture mode (contract e2e_tap, 1.0.4-p1 Q2-002):
   * every frame net handed over, kept in a ring of `max` entries (session applies the default 10,000).
   */
  tap?: boolean | { max?: number };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// Keeps only keys that have the documented shape; everything else is dropped.
function sanitize(raw: unknown): E2EHooks | null {
  if (!isPlainObject(raw)) return null;
  const out: E2EHooks = {};
  if (isPlainObject(raw.dv)) out.dv = raw.dv as Partial<Defaults>;
  if (typeof raw.testSeed === 'string') out.testSeed = raw.testSeed;
  if (raw.llm === null) out.llm = null;
  else if (isPlainObject(raw.llm)) out.llm = raw.llm;
  if (raw.relays === null) out.relays = null;
  else if (isPlainObject(raw.relays) && isStringArray(raw.relays.nostr) && isStringArray(raw.relays.mqtt)) {
    out.relays = { nostr: raw.relays.nostr, mqtt: raw.relays.mqtt };
  }
  if (typeof raw.tap === 'boolean') out.tap = raw.tap;
  else if (isPlainObject(raw.tap)) {
    // Only `max` is defined; it must be a positive integer. Any other key or value drops the whole tap entry.
    const { max, ...rest } = raw.tap;
    const maxOk = max === undefined || (Number.isSafeInteger(max) && (max as number) > 0);
    if (maxOk && Object.keys(rest).length === 0) out.tap = max === undefined ? {} : { max: max as number };
  }
  return out;
}

export function getE2EHooks(): E2EHooks | null {
  if (import.meta.env.VITE_E2E !== 'true') return null;
  if (typeof window === 'undefined') return null;
  return sanitize(window.__CHECKY_E2E__);
}

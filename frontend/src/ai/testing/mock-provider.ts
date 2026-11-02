// Test doubles for the LLM path (C4, I-06): a scripted BotDecider and a scripted fetch. No real provider is ever
// called in tests (project-context section 10). The mock decider is also the VITE_E2E build's decider when the
// E2E hook object carries `llm` (A-APP-COMPOSE), and only in that build it records every BotInput it receives
// into window.__CHECKY_E2E_CAPTURE__ (api.config.v1 e2e_hooks.owners.capture, M17R-04) so W6 E2E can prove a bot
// never saw another seat's cards (SC9, SS7-AC1).
//
// The capture code sits behind `import.meta.env.VITE_E2E === 'true'`, which Vite replaces with a constant at build
// time: release builds drop the branch, the capture function and the global's name (5-3 scan-dist S7).
import { defaults, ERROR_CODES, type ErrorCode } from '@/config';
import type { AbortSignalLike, BotDecider, BotDecision, BotInput, DeciderEvent, Usage } from '@checky/analysis';
import type { EngineActionType, ProviderId } from '@checky/engine/protocol';
import { CheckyError } from '@checky/engine/util';

/**
 * Mock decider options. Everything except `onInput` is JSON-transferable, so an E2E run can pass the same object
 * through window.__CHECKY_E2E__.llm. A `type` (not an interface) so it is assignable to the opaque record config
 * hands over.
 */
export type MockDeciderOpts = {
  /** Wait before answering (default 0). 12,000 ms exercises the 10 s Worker deadline (DV9). */
  delayMs?: number;
  /** Reject every decide() with CheckyError(code) after the delay. */
  fail?: ErrorCode | null;
  /** Answer `raise` to 1 (never legal) to exercise the Worker's nearest-legal correction (SS15-AC3). */
  illegal?: boolean;
  /** Fixed fields merged over the default decision (applied after `illegal`). */
  decision?: Partial<BotDecision>;
  chat?: string;
  thought?: string;
  /** Call cap (default DV10 = 300). */
  cap?: number;
  /** Code only (not JSON): called with each input. Ignored unless it is a function. */
  onInput?: (input: BotInput) => void;
};

const ACTIONS = ['fold', 'check', 'call', 'bet', 'raise', 'allin'] as const satisfies readonly EngineActionType[];
const SOURCES = ['rule', 'llm', 'fallback'] as const;
const PROVIDERS = ['openai', 'anthropic', 'gemini', 'local'] as const satisfies readonly ProviderId[];

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isIntOrNull = (v: unknown): v is number | null => v === null || isInt(v);
const isErrorCode = (v: unknown): v is ErrorCode => typeof v === 'string' && (ERROR_CODES as readonly string[]).includes(v);
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

// Field-by-field copy of a fixed decision: a key with the wrong type is dropped, unknown keys never get in.
function readDecision(raw: Rec): Partial<BotDecision> {
  const d: Partial<BotDecision> = {};
  if (isOneOf(ACTIONS, raw.action)) d.action = raw.action;
  if (isIntOrNull(raw.amount)) d.amount = raw.amount;
  if (typeof raw.reason === 'string') d.reason = raw.reason;
  if (typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1) d.confidence = raw.confidence;
  if (raw.chat === null || typeof raw.chat === 'string') d.chat = raw.chat;
  if (isOneOf(SOURCES, raw.source)) d.source = raw.source;
  if (raw.fallbackCode === null || isErrorCode(raw.fallbackCode)) d.fallbackCode = raw.fallbackCode;
  if (raw.usage === null) d.usage = null;
  else if (isRec(raw.usage) && isIntOrNull(raw.usage.inputTokens) && isIntOrNull(raw.usage.outputTokens)) {
    d.usage = { inputTokens: raw.usage.inputTokens, outputTokens: raw.usage.outputTokens };
  }
  return d;
}

/** Runtime check of the opaque `getE2EHooks().llm` record (config cannot import ai types). */
export function readMockDeciderOpts(raw: Rec): MockDeciderOpts {
  const o: MockDeciderOpts = {};
  if (typeof raw.delayMs === 'number' && Number.isFinite(raw.delayMs) && raw.delayMs >= 0) o.delayMs = raw.delayMs;
  if (raw.fail === null || isErrorCode(raw.fail)) o.fail = raw.fail;
  if (typeof raw.illegal === 'boolean') o.illegal = raw.illegal;
  if (isRec(raw.decision)) o.decision = readDecision(raw.decision);
  if (typeof raw.chat === 'string') o.chat = raw.chat;
  if (typeof raw.thought === 'string') o.thought = raw.thought;
  if (isInt(raw.cap) && raw.cap >= 0) o.cap = raw.cap;
  const onInput = raw.onInput;
  if (typeof onInput === 'function') o.onInput = (input) => void Reflect.apply(onInput, undefined, [input]);
  return o;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Resolves after `ms`, or rejects with AbortError as soon as the signal fires (no 50 ms polling). */
// ponytail: the abort listener is never removed (AbortSignalLike has no removeEventListener); fine with one
// AbortController per request, add removal to the port type if a long-lived signal is ever shared.
function wait(ms: number, signal: AbortSignalLike): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    });
  });
}

// --- VITE_E2E input capture -------------------------------------------------------------------------------------
const captured: BotInput[] = [];
let captureExposed = false;

function capture(input: BotInput): void {
  captured.push(structuredClone(input));
  if (captureExposed || typeof window === 'undefined') return;
  // Getter only: assignment fails, and every read is a fresh deep copy so a test cannot edit what was recorded.
  Object.defineProperty(window, '__CHECKY_E2E_CAPTURE__', {
    get: () => ({ botInputs: structuredClone(captured) }),
    enumerable: false,
    configurable: false,
  });
  captureExposed = true;
}

export function createMockDecider(opts: MockDeciderOpts | Rec = {}): BotDecider {
  const o = readMockDeciderOpts(opts);
  const listeners = new Set<(e: DeciderEvent) => void>();
  const byProvider: Record<ProviderId, number> = { openai: 0, anthropic: 0, gemini: 0, local: 0 };
  let calls = 0;
  let cap = o.cap ?? defaults.DV10;
  let capNoticeSent = false;

  const usage = (): Usage => ({ calls, cap, inputTokens: null, outputTokens: null, byProvider: { ...byProvider } });
  const emit = (e: DeciderEvent): void => {
    for (const cb of listeners) cb(e);
  };

  return {
    async decide(input, signal) {
      if (import.meta.env.VITE_E2E === 'true') capture(input);
      o.onInput?.(input);
      if (signal.aborted) throw abortError();
      if (calls >= cap) {
        // Same contract as the real decider: refuse at once, announce the cap once until it is raised.
        if (!capNoticeSent) emit({ t: 'notice', code: 'N-LLM-CAP', p: { cap } });
        capNoticeSent = true;
        throw new CheckyError('E-LLM-CAP');
      }
      calls += 1;
      const provider = input.model?.provider;
      if (provider !== undefined && isOneOf(PROVIDERS, provider)) byProvider[provider] += 1;
      emit({ t: 'usage', usage: usage() });

      await wait(o.delayMs ?? 0, signal);
      if (o.fail !== undefined && o.fail !== null) throw new CheckyError(o.fail);

      const base: BotDecision = {
        action: input.legal.check ? 'check' : input.legal.call !== null ? 'call' : 'fold',
        amount: null,
        reason: o.thought ?? 'Mock decision.',
        confidence: 0.5,
        chat: o.chat ?? null,
        source: 'llm',
        fallbackCode: null,
        usage: { inputTokens: null, outputTokens: null },
      };
      const shaped: BotDecision = o.illegal === true ? { ...base, action: 'raise', amount: 1 } : base;
      return { ...shaped, ...o.decision };
    },
    usage,
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    setCap(n) {
      if (!isInt(n) || n < 0) return;
      cap = n;
      capNoticeSent = false;
    },
  };
}

// --- scripted fetch for adapter tests (2-2, 3-2) -----------------------------------------------------------------
export interface MockFetchStep {
  status?: number;
  /** A string is sent as is; anything else is JSON-encoded. */
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  /** Reject like a real network failure (TypeError) instead of answering. */
  networkError?: boolean;
}

export interface MockFetchCall {
  url: string;
  method: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: string | null;
}

export type MockFetch = ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) & {
  readonly calls: MockFetchCall[];
};

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** Answers each request with the next script step in order; an exhausted script rejects (tests stay explicit). */
export function createMockFetch(script: readonly MockFetchStep[]): MockFetch {
  const calls: MockFetchCall[] = [];
  let next = 0;
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    // Lower-cased by hand: happy-dom's Headers keeps the original case (browsers lower-case per the Fetch spec).
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    calls.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : null });

    const step = script[next];
    next += 1;
    if (step === undefined) throw new Error('createMockFetch: no scripted response left');
    const signal: AbortSignalLike = init?.signal ?? { aborted: false, addEventListener: () => undefined };
    await wait(step.delayMs ?? 0, signal);
    if (step.networkError === true) throw new TypeError('Failed to fetch');

    const status = step.status ?? 200;
    const text = step.body === undefined || NULL_BODY_STATUS.has(status) ? null : typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    const contentType = typeof step.body === 'string' ? 'text/plain' : 'application/json';
    return new Response(text, { status, headers: { 'content-type': contentType, ...step.headers } });
  };
  return Object.assign(fn, { calls });
}

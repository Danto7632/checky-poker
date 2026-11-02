// AC-11: mock decider options, abort within 50 ms, usage/subscribe/setCap, opaque-record sanitising, VITE_E2E
// capture on/off, and the scripted fetch.
import type { AbortSignalLike, BotInput } from '@checky/analysis';
import { isCheckyError } from '@checky/engine/util';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createMockDecider, createMockFetch, type MockDeciderOpts } from './mock-provider';

// A minimal structurally valid BotInput; the mock only reads legal and model.
function input(over: Partial<BotInput> = {}): BotInput {
  return {
    v: 1,
    seat: 2,
    view: {} as BotInput['view'],
    legal: { fold: true, check: false, call: { amount: 100, to: 200 }, bet: null, raise: { minTo: 400, maxTo: 5000 }, allIn: { to: 5000 }, reopened: true },
    metrics: {
      equity: { value: 0.4, method: 'mc', samples: 1000, halfWidth95: 0.03, opponents: 2 },
      potOdds: { pot: 300, call: 100 },
      requiredEquity: 0.25,
      effectiveStack: 5000,
      spr: null,
      position: { label: 'BB', inPosition: null },
      verdict: 'call_ok',
      basis: 'vs_random_hands',
    },
    style: 'balanced',
    lang: 'en',
    name: 'Mock',
    model: { provider: 'anthropic', model: 'claude-x' },
    chatTail: [],
    myPriorThoughts: [],
    ...over,
  };
}

const live = (): AbortSignal => new AbortController().signal;
const captureOf = (): { botInputs: BotInput[] } | undefined =>
  Reflect.get(window, '__CHECKY_E2E_CAPTURE__') as { botInputs: BotInput[] } | undefined;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('createMockDecider', () => {
  it('a real AbortSignal satisfies AbortSignalLike', () => {
    expectTypeOf<AbortSignal>().toMatchTypeOf<AbortSignalLike>();
  });

  it('defaults: legal check/call/fold, source llm, chat and thought options', async () => {
    const d = createMockDecider({ chat: 'nice hand', thought: 'I think so' });
    await expect(d.decide(input(), live())).resolves.toEqual({
      action: 'call',
      amount: null,
      reason: 'I think so',
      confidence: 0.5,
      chat: 'nice hand',
      source: 'llm',
      fallbackCode: null,
      usage: { inputTokens: null, outputTokens: null },
    });
    const check = input({ legal: { ...input().legal, check: true, call: null } });
    await expect(createMockDecider().decide(check, live())).resolves.toMatchObject({ action: 'check', chat: null });
  });

  it('delayMs 12,000 resolves only after 12 s', async () => {
    vi.useFakeTimers();
    const d = createMockDecider({ delayMs: 12_000 });
    let done = false;
    const p = d.decide(input(), live()).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(11_999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('abort ends a 12 s wait with AbortError within 50 ms', async () => {
    const d = createMockDecider({ delayMs: 12_000 });
    const ac = new AbortController();
    const p = d.decide(input(), ac.signal);
    const t0 = performance.now();
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    const ms = performance.now() - t0;
    console.log(`abort -> AbortError after ${ms.toFixed(1)} ms (abort fired at ~5 ms)`);
    expect(ms).toBeLessThan(55);
  });

  it('an already aborted signal rejects at once', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(createMockDecider().decide(input(), ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fail rejects with CheckyError(code)', async () => {
    const err: unknown = await createMockDecider({ fail: 'E-LLM-RATE' }).decide(input(), live()).catch((e: unknown) => e);
    expect(isCheckyError(err) && err.code).toBe('E-LLM-RATE');
  });

  it('illegal answers raise to 1, decision overrides fields', async () => {
    await expect(createMockDecider({ illegal: true }).decide(input(), live())).resolves.toMatchObject({ action: 'raise', amount: 1 });
    const fixed: MockDeciderOpts = { decision: { action: 'allin', amount: 5000, confidence: 0.9 } };
    await expect(createMockDecider(fixed).decide(input(), live())).resolves.toMatchObject({ action: 'allin', amount: 5000, confidence: 0.9 });
  });

  it('onInput sees each input', async () => {
    const seen: number[] = [];
    await createMockDecider({ onInput: (i) => seen.push(i.seat) }).decide(input({ seat: 4 }), live());
    expect(seen).toEqual([4]);
  });

  it('usage counts calls by provider, emits usage events, unsubscribe stops them', async () => {
    const d = createMockDecider();
    const events: string[] = [];
    const off = d.subscribe((e) => events.push(e.t));
    await d.decide(input(), live());
    await d.decide(input({ model: { provider: 'openai', model: 'gpt' } }), live());
    await d.decide(input({ model: null }), live());
    off();
    await d.decide(input(), live());
    expect(events).toEqual(['usage', 'usage', 'usage']);
    expect(d.usage()).toEqual({
      calls: 4,
      cap: 300,
      inputTokens: null,
      outputTokens: null,
      byProvider: { openai: 1, anthropic: 2, gemini: 0, local: 0 },
    });
  });

  it('cap: refuses with E-LLM-CAP + one N-LLM-CAP notice, setCap re-opens', async () => {
    const d = createMockDecider({ cap: 1 });
    const notices: unknown[] = [];
    d.subscribe((e) => {
      if (e.t === 'notice') notices.push(e);
    });
    await d.decide(input(), live());
    for (let i = 0; i < 2; i += 1) {
      const err: unknown = await d.decide(input(), live()).catch((e: unknown) => e);
      expect(isCheckyError(err) && err.code).toBe('E-LLM-CAP');
    }
    expect(notices).toEqual([{ t: 'notice', code: 'N-LLM-CAP', p: { cap: 1 } }]);
    d.setCap(2);
    d.setCap(-1); // ignored
    await expect(d.decide(input(), live())).resolves.toMatchObject({ source: 'llm' });
    expect(d.usage()).toMatchObject({ calls: 2, cap: 2 });
  });

  it('opaque record: wrong-typed and unknown keys are dropped', async () => {
    const opaque: Readonly<Record<string, unknown>> = {
      delayMs: 'soon',
      fail: 'E-NOT-A-CODE',
      illegal: 'yes',
      cap: 1.5,
      extra: true,
      decision: { action: 'jump', amount: 2.5, reason: 'kept', confidence: 7, source: 'rule', usage: { inputTokens: 'x' } },
    };
    await expect(createMockDecider(opaque).decide(input(), live())).resolves.toEqual({
      action: 'call',
      amount: null,
      reason: 'kept',
      confidence: 0.5,
      chat: null,
      source: 'rule',
      fallbackCode: null,
      usage: { inputTokens: null, outputTokens: null },
    });
    expect(createMockDecider(opaque).usage().cap).toBe(300);
  });
});

describe('VITE_E2E input capture', () => {
  // Order matters: the global is defined once per page (getter, not configurable), like the real E2E page.
  it('off: nothing is recorded and no global appears', async () => {
    vi.stubEnv('VITE_E2E', 'false');
    await createMockDecider().decide(input(), live());
    expect(captureOf()).toBeUndefined();
  });

  it('on: read-only getter returning a fresh deep copy of every input in order', async () => {
    vi.stubEnv('VITE_E2E', 'true');
    const first = input({ seat: 1 });
    await createMockDecider().decide(first, live());
    await createMockDecider({ fail: 'E-LLM-SERVER' }).decide(input({ seat: 3 }), live()).catch(() => undefined);
    first.seat = 99; // later edits of the caller's object do not leak into the record

    const a = captureOf();
    expect(a?.botInputs.map((i) => i.seat)).toEqual([1, 3]);
    a?.botInputs.pop();
    expect(captureOf()?.botInputs).toHaveLength(2);
    expect(captureOf()).not.toBe(captureOf());
    // No setter: Reflect.set reports failure and a strict-mode (ES module) assignment throws.
    expect(Reflect.set(window, '__CHECKY_E2E_CAPTURE__', { botInputs: [] })).toBe(false);
    expect(() => {
      (window as unknown as Record<string, unknown>).__CHECKY_E2E_CAPTURE__ = { botInputs: [] };
    }).toThrow(TypeError);
    expect(captureOf()?.botInputs).toHaveLength(2);
  });
});

describe('createMockFetch', () => {
  it('answers in script order and records url, method, lower-cased headers and body', async () => {
    const f = createMockFetch([{ status: 200, body: { ok: 1 } }, { status: 429, body: 'slow down' }]);
    const r1 = await f('https://api.example/v1', { method: 'POST', headers: { 'X-Api-Key': 'sk-TEST' }, body: '{"a":1}' });
    expect(r1.status).toBe(200);
    await expect(r1.json()).resolves.toEqual({ ok: 1 });
    const r2 = await f(new URL('https://api.example/v2'));
    expect(r2.status).toBe(429);
    await expect(r2.text()).resolves.toBe('slow down');
    expect(f.calls).toEqual([
      { url: 'https://api.example/v1', method: 'POST', headers: { 'x-api-key': 'sk-TEST' }, body: '{"a":1}' },
      { url: 'https://api.example/v2', method: 'GET', headers: {}, body: null },
    ]);
    await expect(f('https://api.example/v3')).rejects.toThrow('no scripted response left');
  });

  it('network error rejects with TypeError, delay honours the abort signal', async () => {
    await expect(createMockFetch([{ networkError: true }])('https://x')).rejects.toBeInstanceOf(TypeError);
    const ac = new AbortController();
    const p = createMockFetch([{ delayMs: 10_000, status: 200 }])('https://x', { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

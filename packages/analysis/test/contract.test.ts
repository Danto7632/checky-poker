// AC-1: bot.io.v1 / api.analysis.v1 type shapes and the C2 behaviour every caller relies on, plus the public
// surface the lead accepted in R0 (lead review R0-L5): computeMetrics takes a MetricsView (a PlayerView passes
// as is), the only exported constant is DISPLAY_EXACT_LIMIT (the metrics Worker's budget), and
// myPriorThoughts[].action is the engine action type (no blinds).
import type { EngineActionType, PlayerView } from '@checky/engine/protocol';
import { createSeededRng } from '@checky/engine/util';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as api from '../src/index';
import {
  computeMetrics,
  decideRuleBot,
  type AbortSignalLike,
  type BotDecider,
  type BotDecision,
  type BotInput,
  type DeciderEvent,
  type DecisionMetrics,
  type MetricsView,
  type Usage,
} from '../src/index';
import { buildSpot } from './helpers/spot';

function botInput(lang: 'en' | 'ja', facingBet: boolean): BotInput {
  const { view, legal } = buildSpot({
    button: 0,
    me: 1,
    hole: ['As', 'Kd'],
    stacks: { 0: 10000, 1: 10000, 2: 10000 },
    board: ['2c', '7d', 'Jh'],
    actions: [
      { seat: 0, type: 'call' },
      { seat: 1, type: 'call' },
      { seat: 2, type: 'check' },
      { seat: 1, type: 'check', street: 'FLOP' },
      ...(facingBet ? [{ seat: 2, type: 'bet' as const, to: 200 }, { seat: 0, type: 'fold' as const }] : []),
    ],
  });
  const metrics = computeMetrics(view, { precision: 'bot', rng: createSeededRng('contract') });
  return { v: 1, seat: 1, view, legal, metrics, style: 'balanced', lang, name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] };
}

describe('contract types (bot.io.v1, api.analysis.v1)', () => {
  it('keeps the contract field sets', () => {
    expectTypeOf<keyof BotDecision>().toEqualTypeOf<
      'action' | 'amount' | 'reason' | 'confidence' | 'chat' | 'source' | 'fallbackCode' | 'usage'
    >();
    expectTypeOf<BotDecision['source']>().toEqualTypeOf<'rule' | 'llm' | 'fallback'>();
    expectTypeOf<keyof BotInput>().toEqualTypeOf<
      'v' | 'seat' | 'view' | 'legal' | 'metrics' | 'style' | 'lang' | 'name' | 'model' | 'chatTail' | 'myPriorThoughts'
    >();
    expectTypeOf<keyof DecisionMetrics>().toEqualTypeOf<
      'equity' | 'potOdds' | 'requiredEquity' | 'effectiveStack' | 'spr' | 'position' | 'verdict' | 'basis'
    >();
    expectTypeOf<keyof DecisionMetrics['equity']>().toEqualTypeOf<'value' | 'method' | 'samples' | 'halfWidth95' | 'opponents'>();
    expectTypeOf<keyof Usage>().toEqualTypeOf<'calls' | 'cap' | 'inputTokens' | 'outputTokens' | 'byProvider'>();
    expectTypeOf<keyof BotDecider>().toEqualTypeOf<'decide' | 'usage' | 'subscribe' | 'setCap'>();
    expectTypeOf<DeciderEvent['t']>().toEqualTypeOf<'usage' | 'notice'>();
    // analysis has no DOM lib; the frontend mock-provider test passes a real AbortSignal through this port.
    expectTypeOf<AbortSignalLike['aborted']>().toEqualTypeOf<boolean>();
  });

  it('keeps the R0-L5 public surface', () => {
    expect(Object.keys(api).sort()).toEqual(['DISPLAY_EXACT_LIMIT', 'computeMetrics', 'decideRuleBot']);
    expectTypeOf<PlayerView>().toExtend<MetricsView>();
    expectTypeOf<Parameters<typeof computeMetrics>[0]>().toEqualTypeOf<MetricsView>();
    expectTypeOf<BotInput['myPriorThoughts'][number]['action']>().toEqualTypeOf<EngineActionType>();
  });
});

// Day 1 shipped the C2 placeholders (check-else-fold, equity 0.5 'mc' with samples null); this block now pins the
// contract behaviour every caller relies on with the real implementations (output recorded in ml.md).
describe('C2 contract behaviour', () => {
  it('decideRuleBot answers a legal, rule-sourced decision in the contract shape', () => {
    for (const facingBet of [false, true]) {
      const input = botInput('en', facingBet);
      const d = decideRuleBot(input, createSeededRng(1));
      expect(Object.keys(d).sort()).toEqual(['action', 'amount', 'chat', 'confidence', 'fallbackCode', 'reason', 'source', 'usage']);
      expect(d).toMatchObject({ chat: null, source: 'rule', fallbackCode: null, usage: null });
      expect(facingBet ? ['fold', 'call', 'raise'] : ['check', 'bet']).toContain(d.action);
    }
  });

  it('decideRuleBot writes the reason in the room language', () => {
    expect(decideRuleBot(botInput('ja', true), createSeededRng(1)).reason).toMatch(/^ランダムな1つの手札に対する勝率/);
    expect(decideRuleBot(botInput('en', true), createSeededRng(1)).reason).toMatch(/^Win chance /);
  });

  it('computeMetrics fills precision metadata consistently with the method and counts opponents', () => {
    const m = botInput('en', true).metrics;
    expect(m.equity.opponents).toBe(1);
    expect(m.equity.method).toBe('mc'); // flop heads-up is Monte Carlo at bot precision
    expect(m.equity.samples).toBe(1000);
    expect(m.equity.halfWidth95).toBeCloseTo(1.96 * Math.sqrt((m.equity.value * (1 - m.equity.value)) / 1000), 12);
    expect(m.basis).toBe('vs_random_hands');
  });
});

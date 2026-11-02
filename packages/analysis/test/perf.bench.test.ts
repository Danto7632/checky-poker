// AC-6 (US19 AC3, DV25, A-ANL-RULEBOT): time of one rule-bot decision = computeMetrics(view, 'bot') +
// decideRuleBot over 1,000 decision points dealt by the real engine (1..5 opponents, preflop..river, nobody
// folds on the way so exactly N opponents remain). Hard limit 1 s per decision (asserted); target p95 <= 50 ms
// (reported, not asserted: wall-clock targets flake on shared CI runners). Samples are never reduced to meet
// it (D-S4). Display precision (p95 <= 500 ms budget) is timed on the first 300 points for the record.
import { applyAction, createHand, evaluate7, legalActions, type HandState } from '@checky/engine';
import type { BotStyle, Card } from '@checky/engine/protocol';
import { createSeededRng, randomInt } from '@checky/engine/util';
import { describe, expect, it } from 'vitest';
import type { BotInput } from '../src/bot/contract';
import { decideRuleBot } from '../src/bot/rule-bot';
import { computeEquity, exactCost, N_BOT } from '../src/metrics/equity';
import { computeMetrics } from '../src/metrics/metrics';
import { log, nowMs, runtime } from './helpers/io';
import { BB, botView, SB } from './sim/driver';

const STREETS = ['PREFLOP', 'FLOP', 'TURN', 'RIVER'] as const;
const STYLES: BotStyle[] = ['aggressive', 'balanced', 'tight'];

/** Deal N+1 players and call/check down until the target street, someone to act. */
function decisionPoint(i: number, rng: ReturnType<typeof createSeededRng>): { state: HandState; seat: number } {
  const opponents = 1 + (i % 5);
  const target = STREETS[Math.floor(i / 5) % 4]!;
  let state = createHand({ handId: `bench-${i}`, seats: Array.from({ length: opponents + 1 }, (_, seat) => ({ seat, stack: 10_000 })), buttonSeat: randomInt(rng, opponents + 1), sb: SB, bb: BB }, rng);
  while (state.street !== target) {
    const seat = state.toAct!;
    const legal = legalActions(state, seat)!;
    state = applyAction(state, legal.call !== null ? { seat, type: 'call' } : { seat, type: 'check' }).state;
  }
  return { state, seat: state.toAct! };
}

const pct = (xs: number[], q: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))]!;

describe('exact-enumeration cost (evidence for DISPLAY_EXACT_LIMIT / BOT_EXACT_LIMIT in equity.ts)', () => {
  it('prints evaluate7 ns/call and the exact path per street x opponents', () => {
    const seven: Card[] = ['As', 'Kd', '2c', '7h', '9s', 'Td', '3c'];
    for (let i = 0; i < 50_000; i += 1) evaluate7(seven);
    const t = nowMs();
    for (let i = 0; i < 300_000; i += 1) evaluate7(seven);
    log(`evaluate7 ${(((nowMs() - t) / 300_000) * 1e6).toFixed(0)} ns/call | ${runtime()}`);
    const hole: Card[] = ['As', 'Kd'];
    const boards: [string, Card[]][] = [['river', ['2c', '7h', '9s', 'Td', '3c']], ['turn', ['2c', '7h', '9s', 'Td']], ['flop', ['2c', '7h', '9s']]];
    for (const [name, board] of boards) {
      for (const n of name === 'flop' ? [1] : [1, 2]) {
        const t0 = nowMs();
        const r = computeEquity(hole, board, n, { samples: 1, exactLimit: Infinity, rng: createSeededRng('exact-cost') });
        log(`exact ${name} N=${n}: ${(nowMs() - t0).toFixed(1)} ms, cost ${Math.round(exactCost(board.length, n))} units, value ${r.value.toFixed(6)}`);
        expect(r.method).toBe('exact');
      }
    }
  }, 120_000);
});

describe('rule bot decision time', () => {
  it('1,000 decision points: max <= 1 s, p95 reported against the 50 ms target', () => {
    const rng = createSeededRng('perf');
    const points = Array.from({ length: 1000 }, (_, i) => decisionPoint(i, rng));
    // Warm the JIT the way a long-running Worker is warm, then measure.
    for (const p of points.slice(0, 50)) computeMetrics(botView(p.state, p.seat, 6, legalActions(p.state, p.seat)!), { precision: 'bot', rng });

    const total: number[] = [];
    const metricsMs: number[] = [];
    points.forEach((p, i) => {
      const legal = legalActions(p.state, p.seat)!;
      const view = botView(p.state, p.seat, 6, legal);
      const t0 = nowMs();
      const metrics = computeMetrics(view, { precision: 'bot', rng });
      const t1 = nowMs();
      const input: BotInput = { v: 1, seat: p.seat, view, legal, metrics, style: STYLES[i % 3]!, lang: 'en', name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] };
      decideRuleBot(input, rng);
      const t2 = nowMs();
      metricsMs.push(t1 - t0);
      total.push(t2 - t0);
    });
    const p95 = pct(total, 0.95);
    log(
      `bot decision (computeMetrics bot + decideRuleBot) N_BOT=${N_BOT} points=${total.length} p50=${pct(total, 0.5).toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${Math.max(...total).toFixed(2)}ms ` +
        `metrics p95=${pct(metricsMs, 0.95).toFixed(2)}ms target p95<=50ms ${p95 <= 50 ? 'met' : 'MISSED'} | ${runtime()}`,
    );

    const display: number[] = [];
    for (const p of points.slice(0, 300)) {
      const view = botView(p.state, p.seat, 6, legalActions(p.state, p.seat)!);
      const t0 = nowMs();
      computeMetrics(view, { precision: 'display', rng });
      display.push(nowMs() - t0);
    }
    log(`display computeMetrics points=300 p50=${pct(display, 0.5).toFixed(1)}ms p95=${pct(display, 0.95).toFixed(1)}ms max=${Math.max(...display).toFixed(1)}ms budget p95<=500ms`);

    expect(Math.max(...total)).toBeLessThanOrEqual(1000);
  }, 300_000);
});

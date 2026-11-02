// AC-7 (SS14 rules 1-2, SC4 sentence marking): rule-bot output shape, en/ja reason templates and the legal
// amount property.
// - 20 fixed spots x en/ja: 10 end exact at bot precision (river, N <= 2), 10 end Monte Carlo. Snapshot of every
//   decision, length <= 200, the numbers in the sentence are exactly the metrics rounded like the UI, no "GTO",
//   "about" / 「約」 right before the win chance only when the equity is an estimate.
// - 10,000 random LegalActions: every bet/raise amount is inside its legal range, no unavailable action, and an
//   'allin' only where it is its own action (allIn.to above the call and raising open — lead review R0 3.1 M2).
// - Unopened pot with raising closed (lead review R0 3.2 M1): the two engine-dealt spots from the review (UTG 150
//   with AA, heads-up BB all-in for 60 from the blind), the BB's option with a short stack (nothing to call; re-review
//   1 i-1) and a property over random closed-raise inputs.
import { applyAction, createHand, legalActions } from '@checky/engine';
import { CARD_RANKS, CARD_SUITS, type Card, type LegalActions, type PlayerView } from '@checky/engine/protocol';
import { createSeededRng, randomInt } from '@checky/engine/util';
import { describe, expect, it } from 'vitest';
import type { BotDecision, BotInput, DecisionMetrics } from '../src/bot/contract';
import { preflopPercentile } from '../src/bot/preflop';
import { decideRuleBot } from '../src/bot/rule-bot';
import { STYLES } from '../src/bot/styles';
import { computeMetrics } from '../src/metrics/metrics';
import { randomInput } from './helpers/random-input';
import { buildSpot, limpedSpot, type SpotSpec } from './helpers/spot';
import { BB, botView, illegalReason, SB } from './sim/driver';

type Fixed = { id: string; spec: (lang: 'en' | 'ja') => SpotSpec; style: BotInput['style'] };
const c = (s: string): Card[] => (s.match(/../g) ?? []) as Card[];
const hole = (s: string): [Card, Card] => c(s) as [Card, Card];

const EXACT: Fixed[] = [
  ['AsKd', '2c7h9sTd3c', 1, true],
  ['AsKd', '2c7h9sTd3c', 2, false],
  ['8h8d', 'Kc7h2s3d4c', 1, false],
  ['8h8d', 'Kc7h2s3d4c', 2, true],
  ['JcTc', '9c8d2h3sQd', 1, true],
  ['JcTc', '9c8d2h3sQd', 2, true],
  ['7h6h', 'Ah9h2c3hKd', 1, false],
  ['7h6h', 'Ah9h2c3hKd', 2, true],
  ['2c3d', 'AsKsQsJsTs', 1, true],
  ['Qc5d', 'Kh9s7d4c2h', 2, false],
].map(([h, b, n, f], i) => ({ id: `exact-${i}`, spec: (lang) => limpedSpot(hole(h as string), c(b as string), n as number, f as boolean, lang), style: (['balanced', 'aggressive', 'tight'] as const)[i % 3]! }));

const MC: Fixed[] = [
  { id: 'mc-pf-hu', spec: (lang) => ({ ...limpedSpot(hole('AhKd'), [], 1, false, lang) }), style: 'aggressive' },
  { id: 'mc-pf-6max-raise', spec: (lang) => ({ button: 0, me: 0, hole: hole('QhJh'), lang, stacks: { 0: 10000, 1: 10000, 2: 10000, 3: 10000, 4: 10000, 5: 10000 }, actions: [{ seat: 3, type: 'raise', to: 300 }, { seat: 4, type: 'call' }, { seat: 5, type: 'fold' }] }), style: 'balanced' },
  ...[
    ['AsKs', 'Qs7s2d', 1, true],
    ['8h8d', 'Kc7h2s', 3, false],
    ['JcTc', '9c8d2h', 2, true],
    ['6s6h', '6d9cKh', 4, true],
    ['KhQh', 'JhTh2s3c', 1, true],
    ['9d8d', 'KsQh2c4d', 3, false],
    ['AhQd', 'AdTs5c8h', 2, true],
    ['5c4c', 'Ac9d3h2s', 5, false],
  ].map(([h, b, n, f], i): Fixed => ({ id: `mc-${i}`, spec: (lang) => limpedSpot(hole(h as string), c(b as string), n as number, f as boolean, lang), style: (['tight', 'balanced', 'aggressive'] as const)[i % 3]! })),
];

function decideFixed(f: Fixed, lang: 'en' | 'ja'): { input: BotInput; decision: BotDecision } {
  const { view, legal } = buildSpot(f.spec(lang));
  const metrics = computeMetrics(view, { precision: 'bot', rng: createSeededRng(`shape/${f.id}`) });
  const input: BotInput = { v: 1, seat: view.me.seat!, view, legal, metrics, style: f.style, lang, name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] };
  return { input, decision: decideRuleBot(input, createSeededRng(`shape/${f.id}/bot`)) };
}

/** Numbers the sentence must contain: N, win %, and with a price the ratio, the ": 1" and the needed %. */
function expectedNumbers(m: BotInput['metrics']): string[] {
  const out = [String(m.equity.opponents), (m.equity.value * 100).toFixed(1)];
  if (m.potOdds !== null && m.requiredEquity !== null) out.push((m.potOdds.pot / m.potOdds.call).toFixed(1), '1', (m.requiredEquity * 100).toFixed(1));
  return out.sort();
}

describe.each(['en', 'ja'] as const)('rule bot output (%s)', (lang) => {
  const rows = [...EXACT, ...MC].map((f) => ({ id: f.id, ...decideFixed(f, lang) }));

  it('10 fixed spots end exact and 10 end Monte Carlo at bot precision', () => {
    expect(rows.filter((r) => r.input.metrics.equity.method === 'exact').map((r) => r.id)).toEqual(EXACT.map((f) => f.id));
    expect(rows.filter((r) => r.input.metrics.equity.method === 'mc').map((r) => r.id)).toEqual(MC.map((f) => f.id));
  });

  it('matches the snapshot', () => {
    expect(rows.map((r) => ({ id: r.id, ...r.decision }))).toMatchSnapshot();
  });

  it.each(rows)('$id: contract shape, sentence numbers and estimate marking', ({ input, decision }) => {
    expect(Object.keys(decision).sort()).toEqual(['action', 'amount', 'chat', 'confidence', 'fallbackCode', 'reason', 'source', 'usage']);
    expect(decision).toMatchObject({ chat: null, source: 'rule', fallbackCode: null, usage: null });
    expect(decision.confidence).toBeGreaterThanOrEqual(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
    expect(illegalReason(decision, input.legal)).toBeNull();
    if (decision.action === 'fold' || decision.action === 'check' || decision.action === 'call') expect(decision.amount).toBeNull();

    const reason = decision.reason;
    expect(reason.length).toBeLessThanOrEqual(200);
    expect(reason).not.toMatch(/GTO/i);
    expect((reason.match(/\d+(\.\d+)?/g) ?? []).sort()).toEqual(expectedNumbers(input.metrics));
    const estimate = lang === 'en' ? /about \d+(\.\d)?%/ : /約\d+(\.\d)?%/;
    if (input.metrics.equity.method === 'mc') expect(reason).toMatch(estimate);
    else {
      expect(reason).not.toMatch(/about \d+(\.\d)?%/);
      expect(reason).not.toMatch(/約\d+(\.\d)?%/);
    }
    // Pot odds and required equity are exact arithmetic: never qualified.
    expect(reason).not.toMatch(lang === 'en' ? /needs about/ : /必要勝率約/);
  });
});

describe('ko falls back to en (D-S5)', () => {
  it('uses the English template', () => {
    const { input } = decideFixed(MC[0]!, 'en');
    const ko = decideRuleBot({ ...input, lang: 'ko' }, createSeededRng('ko'));
    expect(ko).toEqual(decideRuleBot({ ...input, lang: 'en' }, createSeededRng('ko')));
    expect(ko.reason).toMatch(/^Win chance about \d+\.\d% vs 1 random hand\b/);
  });
});

/**
 * The consumer rule for 'allin' (lead review R0 3.1 M2): it is a separate action only when it puts in more than
 * the call (or than my current bet when there is nothing to call) and raising is open for me.
 */
function separateAllIn(legal: LegalActions, currentBet: number): boolean {
  return legal.reopened && legal.allIn.to > (legal.call?.to ?? currentBet);
}

describe('legal amounts (property, 10,000 random LegalActions)', () => {
  it('the judge takes an all-in only at exactly allIn.to, as the engine does', () => {
    const legal: LegalActions = { fold: true, check: false, call: { amount: 100, to: 100 }, bet: null, raise: null, allIn: { to: 150 }, reopened: true };
    const allin = (amount: number | null): BotDecision => ({ action: 'allin', amount, reason: '', confidence: 0.5, chat: null, source: 'rule', fallbackCode: null, usage: null });
    expect(illegalReason(allin(150), legal)).toBeNull();
    expect(illegalReason(allin(null), legal)).not.toBeNull();
    expect(illegalReason(allin(149), legal)).not.toBeNull();
    expect(illegalReason(allin(150), { ...legal, reopened: false })).not.toBeNull();
  });

  it('never leaves the legal range, never picks an unavailable action, all-in only as its own action', () => {
    const r = createSeededRng('rule-bot/property');
    const bad: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const input = randomInput(r);
      const d = decideRuleBot(input, r);
      seen.add(d.action);
      let why = illegalReason(d, input.legal);
      if (why === null && d.action === 'allin' && !separateAllIn(input.legal, input.view.hand!.currentBet)) why = 'all-in that is not its own action';
      if (why !== null && bad.length < 5) bad.push(`#${i} ${why} ${JSON.stringify(d)} legal=${JSON.stringify(input.legal)}`);
    }
    expect(bad).toEqual([]);
    // Every branch the bot has was exercised.
    expect([...seen].sort()).toEqual(['allin', 'bet', 'call', 'check', 'fold', 'raise']);
  });
});

/**
 * A preflop spot dealt by the real engine, with my hole cards replaced (the bot reads only its own view, and the
 * engine never looks at cards before showdown, so the swap cannot change what is legal). The first `limps` players
 * to act call through the engine first (the SB completes), so a spot can be the big blind's option.
 */
function engineSpot(stacks: number[], hole: [Card, Card], limps = 0): { input: (style: BotInput['style']) => BotInput; accept: (d: BotDecision) => void } {
  let state = createHand({ handId: 'm1', seats: stacks.map((stack, seat) => ({ seat, stack })), buttonSeat: 0, sb: SB, bb: BB }, createSeededRng('m1/deal'));
  for (let i = 0; i < limps; i += 1) state = applyAction(state, { seat: state.toAct!, type: 'call' }).state;
  const seat = state.toAct!;
  const legal = legalActions(state, seat)!;
  const dealt = botView(state, seat, stacks.length, legal);
  const view = { ...dealt, me: { ...dealt.me, holeCards: hole } } as PlayerView;
  const metrics = computeMetrics(view, { precision: 'bot', rng: createSeededRng('m1/metrics') });
  return {
    input: (style) => ({ v: 1, seat, view, legal, metrics, style, lang: 'en', name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] }),
    // The engine is the judge of legality: it throws E-ACT-* on anything it would not take.
    accept: (d) => {
      applyAction(state, d.amount === null || d.action === 'call' ? { seat, type: d.action } : { seat, type: d.action, to: d.amount });
    },
  };
}

describe('unopened pot with raising closed (lead review R0 3.2 M1)', () => {
  const styles = ['aggressive', 'balanced', 'tight'] as const;

  it('UTG with 150 behind and AA (no min-raise possible, all-in is more than the call) goes all-in', () => {
    // 6 seats, button 0: UTG is seat 3. Engine: call {100, 100}, raise null (maxTo 150 < minTo 200), allIn {150}.
    const spot = engineSpot([10000, 10000, 10000, 150, 10000, 10000], ['As', 'Ah']);
    for (const style of styles) {
      const input = spot.input(style);
      expect(input.legal).toMatchObject({ call: { amount: 100, to: 100 }, raise: null, allIn: { to: 150 }, reopened: true });
      const d = decideRuleBot(input, createSeededRng(`m1/utg/${style}`));
      expect(d, style).toMatchObject({ action: 'allin', amount: 150 });
      expect(() => spot.accept(d), style).not.toThrow();
    }
  });

  it('heads-up, the BB all-in for 60 from the blind: the button calls with AA instead of folding', () => {
    // Nobody is left to respond, so raising is closed (reopened false) and the call completes the big blind.
    const spot = engineSpot([10000, 60], ['As', 'Ah']);
    for (const style of styles) {
      const input = spot.input(style);
      expect(input.legal).toMatchObject({ call: { amount: 50, to: 100 }, raise: null, reopened: false });
      const d = decideRuleBot(input, createSeededRng(`m1/hu/${style}`));
      expect(d, style).toMatchObject({ action: 'call', amount: null });
      expect(() => spot.accept(d), style).not.toThrow();
    }
  });

  it("the BB's option with 50 behind its blind: AA goes all-in to 150 (nothing to call), 72o checks", () => {
    // 3 seats, button 0: the button limps and the SB completes, so the BB (seat 2, 150 dealt) acts last with its
    // 100 posted. Engine: check true, call null, raise null (maxTo 150 < minTo 200), allIn {150}, reopened true.
    // The only spot type where the all-in test reads its fallback: with call null, `call?.to ?? currentBet` is the
    // current bet (= my own 100). Pinned order (R0 3.2 M1): all-in -> call -> check -> fold. If check moves ahead
    // of the closed-raise branch, or the all-in test needs a call, AA checks; if the open-range test is dropped,
    // 72o shoves. Re-review 1 i-1 asked for this spot as a fixed input.
    const cases = [
      { hole: ['As', 'Ah'], decision: { action: 'allin', amount: 150 } },
      { hole: ['7c', '2d'], decision: { action: 'check', amount: null } },
    ] as const;
    for (const { hole: cards, decision } of cases) {
      const spot = engineSpot([10000, 10000, 150], [...cards], 2);
      for (const style of styles) {
        const input = spot.input(style);
        expect(input.seat).toBe(2);
        expect(input.view.hand).toMatchObject({ currentBet: 100, bbSeat: 2 });
        expect(input.legal).toMatchObject({ check: true, call: null, bet: null, raise: null, allIn: { to: 150 }, reopened: true });
        const d = decideRuleBot(input, createSeededRng(`m1/bb-option/${style}`));
        expect(d, `${style} ${cards.join('')}`).toMatchObject(decision);
        expect(() => spot.accept(d), `${style} ${cards.join('')}`).not.toThrow();
      }
    }
  });

  it('property: an opening hand never folds when it can go all-in past the call or its equity covers the price', () => {
    // Random closed-raise legal sets on an unopened preflop view, random hands inside the style's open range,
    // random metrics. Priority under test: all-in (own action) -> call (equity covers price - slack) -> fold.
    const r = createSeededRng('rule-bot/closed-raise');
    const deck = CARD_RANKS.flatMap((k) => CARD_SUITS.map((u): Card => `${k}${u}`));
    const bad: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const style = styles[randomInt(r, 3)]!;
      const params = STYLES[style];
      let hole: [Card, Card];
      do hole = [deck[randomInt(r, 52)]!, deck[randomInt(r, 52)]!];
      while (hole[0] === hole[1] || preflopPercentile(hole[0], hole[1]) > params.openTop);
      // Limped to me on the button (currentBet = BB, an unopened pot); my bet is 0, the call is 1 BB or my stack.
      const { view } = buildSpot({ button: 0, me: 0, hole, stacks: { 0: 10000, 1: 10000, 2: 10000, 3: 10000 }, actions: [{ seat: 3, type: 'call' }] });
      const stack = 1 + randomInt(r, 2 * BB - 1); // < 2 BB: no min-raise is possible
      const callAmount = Math.min(BB, stack);
      // allIn.to stays the whole stack even when reopened is false (the pre-p2 engine shape): the bot must check
      // `reopened` itself rather than rely on the engine capping allIn.to.
      const legal: LegalActions = { fold: true, check: false, call: { amount: callAmount, to: callAmount }, bet: null, raise: null, allIn: { to: stack }, reopened: randomInt(r, 2) === 0 };
      const required = callAmount / (250 + callAmount);
      const value = randomInt(r, 1_000_001) / 1_000_000;
      // Pot = SB 50 + BB 100 + the limp 100.
      const metrics: DecisionMetrics = {
        equity: { value, method: 'mc', samples: 1000, halfWidth95: 1.96 * Math.sqrt((value * (1 - value)) / 1000), opponents: 3 },
        potOdds: { pot: 250, call: callAmount },
        requiredEquity: required,
        effectiveStack: stack,
        spr: null,
        position: { label: 'BTN', inPosition: null },
        verdict: value >= required ? 'call_ok' : 'call_short',
        basis: 'vs_random_hands',
      };
      const input: BotInput = { v: 1, seat: 0, view, legal, metrics, style, lang: 'en', name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] };
      const d = decideRuleBot(input, r);
      seen.add(d.action);
      const shove = separateAllIn(legal, view.hand!.currentBet);
      const covered = value >= required - params.callSlack;
      const expected = shove ? 'allin' : covered ? 'call' : 'fold';
      const why = illegalReason(d, legal);
      if ((why !== null || d.action !== expected || (d.action === 'allin' && d.amount !== stack)) && bad.length < 5) {
        bad.push(`#${i} ${style} ${hole.join('')} expected ${expected} got ${JSON.stringify(d)} legal=${JSON.stringify(legal)} eq=${value} req=${required}`);
      }
    }
    expect(bad).toEqual([]);
    expect([...seen].sort()).toEqual(['allin', 'call', 'fold']);
  });
});

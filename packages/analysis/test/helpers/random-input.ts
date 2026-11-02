// Random BotInputs for property tests: a base view per decision type (preflop unopened / facing a raise, flop,
// turn, river) with random LegalActions, metrics, style and language drawn from a seeded Rng. LegalActions follow
// the engine's shapes (checked-to with or without a bet option, BB option, facing a bet with raise open or closed,
// short all-in calls); the view is not kept consistent with them on purpose — amounts must stay legal anyway.
// With raising closed (reopened false) allIn.to is either the engine's capped value (min(stack, call.to or my bet),
// lead review R0 3.1 M2) or the whole stack, which a bot must still never send as its own all-in.
import type { BotStyle, LegalActions } from '@checky/engine/protocol';
import { randomInt, type Rng } from '@checky/engine/util';
import type { BotInput, DecisionMetrics } from '../../src/bot/contract';
import { buildSpot, limpedSpot } from './spot';

const BASES = [
  buildSpot({ button: 0, me: 0, hole: ['Ah', 'Kd'], stacks: { 0: 10000, 1: 10000, 2: 10000, 3: 10000 }, actions: [{ seat: 3, type: 'call' }] }),
  buildSpot({ button: 0, me: 0, hole: ['7c', '7d'], stacks: { 0: 10000, 1: 10000, 2: 10000, 3: 10000 }, actions: [{ seat: 3, type: 'raise', to: 300 }] }),
  buildSpot(limpedSpot(['Qs', 'Js'], ['Ts', '9d', '2c'], 2, true)),
  buildSpot(limpedSpot(['5h', '5c'], ['Kd', '8s', '3h', '2d'], 1, false)),
  buildSpot(limpedSpot(['Ac', '2c'], ['Kc', '9c', '4h', '7d', 'Js'], 3, true)),
].map((b) => b.view);
const STYLES: BotStyle[] = ['aggressive', 'balanced', 'tight'];
const BB = 100;

export function randomLegal(r: Rng): LegalActions {
  const stack = 1 + randomInt(r, 20_000);
  const kind = randomInt(r, 3);
  const reopened = randomInt(r, 5) !== 0;
  const capped = !reopened && randomInt(r, 2) === 0;
  const allInTo = (maxTo: number, callTo: number): { to: number } => ({ to: capped ? Math.min(maxTo, callTo) : maxTo });
  if (kind === 0) {
    // Checked to me, nothing bet on this street.
    const bet = reopened && stack >= BB ? { min: BB, max: stack } : null;
    return { fold: true, check: true, call: null, bet, raise: null, allIn: allInTo(stack, 0), reopened };
  }
  const currentBet = BB + randomInt(r, 3000);
  if (kind === 1) {
    // BB option: my bet already equals the current bet.
    const maxTo = currentBet + stack;
    const raise = reopened && maxTo >= currentBet + BB ? { minTo: currentBet + BB, maxTo } : null;
    return { fold: true, check: true, call: null, bet: null, raise, allIn: allInTo(maxTo, currentBet), reopened };
  }
  const myBet = randomInt(r, currentBet);
  const toCall = currentBet - myBet;
  const amount = Math.min(toCall, stack);
  const maxTo = myBet + stack;
  const minTo = currentBet + BB + randomInt(r, 2000);
  const raise = reopened && maxTo >= minTo ? { minTo, maxTo } : null;
  return { fold: true, check: false, call: { amount, to: myBet + amount }, bet: null, raise, allIn: allInTo(maxTo, myBet + amount), reopened };
}

export function randomInput(r: Rng): BotInput {
  const view = BASES[randomInt(r, BASES.length)]!;
  const legal = randomLegal(r);
  const exact = randomInt(r, 2) === 0;
  const value = randomInt(r, 1_000_001) / 1_000_000;
  const opponents = 1 + randomInt(r, 5);
  const pot = 150 + randomInt(r, 30_000);
  const potOdds = legal.call === null ? null : { pot, call: legal.call.amount };
  const requiredEquity = potOdds === null ? null : potOdds.call / (potOdds.pot + potOdds.call);
  const metrics: DecisionMetrics = {
    equity: exact
      ? { value, method: 'exact', samples: null, halfWidth95: null, opponents }
      : { value, method: 'mc', samples: 1000, halfWidth95: 1.96 * Math.sqrt((value * (1 - value)) / 1000), opponents },
    potOdds,
    requiredEquity,
    effectiveStack: legal.allIn.to,
    spr: view.hand?.street === 'PREFLOP' ? null : randomInt(r, 5000) / 100,
    position: { label: 'BTN', inPosition: view.hand?.street === 'PREFLOP' ? null : randomInt(r, 2) === 0 },
    verdict: requiredEquity === null ? null : value >= requiredEquity ? 'call_ok' : 'call_short',
    basis: 'vs_random_hands',
  };
  const lang = (['en', 'ja', 'ko'] as const)[randomInt(r, 3)]!;
  return { v: 1, seat: 0, view, legal, metrics, style: STYLES[randomInt(r, 3)]!, lang, name: 'Bot', model: null, chatTail: [], myPriorThoughts: [] };
}

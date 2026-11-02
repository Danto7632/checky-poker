// decideRuleBot (A-ANL-RULEBOT, SS14): the key-free opponent and the LLM bot's fallback decider.
//
// Inputs are only the BotInput (that bot's own projected view, its metrics, its legal actions and style), so a
// rule bot cannot see another seat's cards (SS14 rule 1). Randomness comes only from the injected Rng: same input
// and same seed give the same decision (rule 4).
//
// Preflop: the hand's combo percentile (preflop.ts) against the style's open / call / 3-bet ranges; calls also
// need equity >= required - callSlack, which keeps junk from calling big all-ins. Postflop: strength = equity x
// (N + 1) against value / raise thresholds, pot odds for calls, a style-dependent bluff chance when checked to.
//
// Amounts are always picked inside `legal` (bet.min..max, raise.minTo..maxTo, allIn.to) and never recomputed
// from the betting rules (B-E4). A bet or raise to the range max is the same chips as an all-in, so 'allin' is
// sent only where no raise is offered: an opening hand in an unopened pot whose stack is below a min-raise. It is
// sent only as its own action, i.e. allIn.to above the call and raising open (consumer rule, lead review R0 3.1
// M2); otherwise a closed raise leaves call / check / fold, with the same call test as facing a raise (R0 3.2 M1:
// before this, an unopened pot with raise null folded every hand, AA included).
//
// reason: a template sentence in the room language built only from input.metrics, rounded like the UI (one
// decimal). Monte Carlo equity gets "about" / 「約」, exact equity does not (ui-spec 0.5 rule 7, SC4). Pot odds
// and required equity are exact arithmetic, so they never get the qualifier. No hand names (no i18n here), no
// "GTO". lang 'ko' falls back to en (D-S5).
import type { EngineActionType } from '@checky/engine/protocol';
import type { Rng } from '@checky/engine/util';
import { potSize } from '../metrics/pot-odds';
import type { BotDecision, BotInput, DecisionMetrics } from './contract';
import { preflopPercentile } from './preflop';
import { STYLES, type StyleParams } from './styles';

interface Choice {
  action: EngineActionType;
  amount: number | null;
  /** How far the deciding number is past its threshold; feeds confidence. */
  edge: number;
}

/** Uniform in [0, 1) from one 32-bit draw. */
const unit = (rng: Rng): number => rng.nextUint32() / 0x1_0000_0000;

function clampTo(target: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(target)));
}

function preflop(input: BotInput, style: StyleParams, rng: Rng): Choice {
  const { legal, view, metrics } = input;
  const hand = view.hand!;
  const [a, b] = view.me.holeCards!;
  const p = preflopPercentile(a, b);
  const bb = view.room.settings.bb;
  const eq = metrics.equity.value;
  const required = metrics.requiredEquity ?? 0;
  /** The preflop call test: hand inside the `top` fraction and equity covering the price minus the style's slack. */
  const calls = (top: number): boolean => legal.call !== null && p <= top && eq >= required - style.callSlack;

  if (hand.currentBet <= bb) {
    // Unopened or limped: open the range, sometimes a hand just outside it.
    const steal = p <= style.openTop + 0.1 && unit(rng) < style.bluffFreq;
    if ((p <= style.openTop || steal) && legal.raise !== null) {
      const limpers = hand.actions.filter((x) => x.street === 'PREFLOP' && x.type === 'call').length;
      const to = clampTo((style.openSizeBb + limpers) * bb, legal.raise.minTo, legal.raise.maxTo);
      return { action: 'raise', amount: to, edge: style.openTop - p };
    }
    if (legal.raise === null) {
      // Raising is closed: a stack below a min-raise, or nobody left who could respond (a short BB all-in from
      // the blind). An opening hand goes all-in when that is its own action; with nothing to call, `call?.to`
      // falls back to the current bet, which then is my bet. Otherwise the opening range may still call: the
      // hand would have raised, so it is not a hand that folds to the price (the equity test still applies).
      const ownAllIn = legal.reopened && legal.allIn.to > (legal.call?.to ?? hand.currentBet);
      if (p <= style.openTop && ownAllIn) return { action: 'allin', amount: legal.allIn.to, edge: style.openTop - p };
      if (calls(Math.max(style.callTop, style.openTop))) return { action: 'call', amount: null, edge: eq - required };
    }
    if (legal.check) return { action: 'check', amount: null, edge: p - style.openTop };
    return { action: 'fold', amount: null, edge: p - style.openTop };
  }
  if (p <= style.threeBetTop && legal.raise !== null) {
    return { action: 'raise', amount: clampTo(3 * hand.currentBet, legal.raise.minTo, legal.raise.maxTo), edge: style.threeBetTop - p };
  }
  if (calls(style.callTop)) return { action: 'call', amount: null, edge: eq - required };
  if (legal.check) return { action: 'check', amount: null, edge: 0 };
  return { action: 'fold', amount: null, edge: Math.max(p - style.callTop, required - eq) };
}

function postflop(input: BotInput, style: StyleParams, rng: Rng): Choice {
  const { legal, view, metrics } = input;
  const eq = metrics.equity.value;
  const strength = eq * (metrics.equity.opponents + 1);
  const pot = potSize(view);
  const size = style.sizes[Math.floor(unit(rng) * style.sizes.length)] ?? 0.5;

  if (legal.call === null) {
    if (legal.bet !== null && (strength >= style.valueStrength || unit(rng) < style.bluffFreq)) {
      return { action: 'bet', amount: clampTo(size * pot, legal.bet.min, legal.bet.max), edge: strength - style.valueStrength };
    }
    if (legal.check) return { action: 'check', amount: null, edge: style.valueStrength - strength };
    return { action: 'fold', amount: null, edge: 0 };
  }
  const required = metrics.requiredEquity ?? 0;
  if (legal.raise !== null && strength >= style.raiseStrength) {
    const to = clampTo(legal.call.to + size * (pot + legal.call.amount), legal.raise.minTo, legal.raise.maxTo);
    return { action: 'raise', amount: to, edge: strength - style.raiseStrength };
  }
  if (eq >= required - style.callSlack) return { action: 'call', amount: null, edge: eq - required };
  return { action: 'fold', amount: null, edge: required - eq };
}

const VERB_EN: Record<EngineActionType, string> = {
  fold: 'folding',
  check: 'checking',
  call: 'calling',
  bet: 'betting',
  raise: 'raising',
  allin: 'going all-in',
};
const VERB_JA: Record<EngineActionType, string> = {
  fold: 'フォールド',
  check: 'チェック',
  call: 'コール',
  bet: 'ベット',
  raise: 'レイズ',
  allin: 'オールイン',
};

/** Same rounding as the UI: x * 100 with one decimal (ui-spec 0.5 rule 2, CalcChips). */
const pct = (x: number): string => (x * 100).toFixed(1);

export function reasonText(m: DecisionMetrics, action: EngineActionType, lang: BotInput['lang']): string {
  const n = m.equity.opponents;
  const estimate = m.equity.method === 'mc';
  const win = pct(m.equity.value);
  if (lang === 'ja') {
    const odds = m.potOdds === null || m.requiredEquity === null ? '' : `、ポットオッズ${(m.potOdds.pot / m.potOdds.call).toFixed(1)} : 1で必要勝率${pct(m.requiredEquity)}%`;
    return `ランダムな${n}つの手札に対する勝率${estimate ? '約' : ''}${win}%${odds} — ${VERB_JA[action]}。`;
  }
  const odds = m.potOdds === null || m.requiredEquity === null ? '' : `; pot odds ${(m.potOdds.pot / m.potOdds.call).toFixed(1)} : 1 needs ${pct(m.requiredEquity)}%`;
  return `Win chance ${estimate ? 'about ' : ''}${win}% vs ${n} random hand${n === 1 ? '' : 's'}${odds} — ${VERB_EN[action]}.`;
}

export function decideRuleBot(input: BotInput, rng: Rng): BotDecision {
  if (input.view.hand === null || input.view.me.holeCards === null) throw new Error('decideRuleBot: needs a hand and hole cards');
  const style = STYLES[input.style];
  const choice = input.view.hand.street === 'PREFLOP' ? preflop(input, style, rng) : postflop(input, style, rng);
  // confidence = 0.5 + edge / 2, clamped so a rule bot never claims certainty, two decimals.
  const confidence = Math.round(Math.min(0.95, Math.max(0.05, 0.5 + choice.edge / 2)) * 100) / 100;
  return {
    action: choice.action,
    amount: choice.amount,
    reason: reasonText(input.metrics, choice.action, input.lang),
    confidence,
    chat: null,
    source: 'rule',
    fallbackCode: null,
    usage: null,
  };
}

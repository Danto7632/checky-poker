// computeMetrics (A-ANL-METRICS): the one function behind every number the product shows (SS20) — the rule bot,
// the LLM bot input, LiveOdds, review, coaching and the arena all call this, so a number means the same thing
// everywhere.
//
// precision 'display' = DV23 (exact, or Monte Carlo n = 10,000); 'bot' = N_BOT samples and a smaller exact
// budget so a bot decision stays inside 50 ms. `exactLimit` lets the metrics Worker lower the exact budget after
// an E-ANL-SLOW reply (D-S7); the sample counts are never lowered.
import type { Rng } from '@checky/engine/util';
import type { DecisionMetrics, MetricsPrecision, MetricsView } from '../bot/contract';
import { BOT_EXACT_LIMIT, computeEquity, DISPLAY_EXACT_LIMIT, DISPLAY_SAMPLES, N_BOT } from './equity';
import { potOdds, requiredEquity } from './pot-odds';
import { position } from './position';
import { effectiveStack, spr } from './spr';

/** N of "vs N random hands": opponents still in the hand (all-in included). */
export function countOpponents(view: MetricsView): number {
  let n = 0;
  for (const s of view.seats) {
    const o = s.occupant;
    if (o !== null && !o.isMe && o.inHand !== null && !o.inHand.folded) n += 1;
  }
  return n;
}

export function computeMetrics(
  view: MetricsView,
  opts: { precision: MetricsPrecision; rng: Rng; exactLimit?: number },
): DecisionMetrics {
  const hand = view.hand;
  const hole = view.me.holeCards;
  // Preconditions are caller bugs (architecture_compliance: a plain Error, no product error code).
  if (hand === null || hole === null) throw new Error('computeMetrics: needs a hand and my hole cards');
  const opponents = countOpponents(view);
  if (opponents === 0) throw new Error('computeMetrics: no opponent left in the hand');

  const display = opts.precision === 'display';
  const equity = computeEquity(hole, hand.board, opponents, {
    samples: display ? DISPLAY_SAMPLES : N_BOT,
    exactLimit: opts.exactLimit ?? (display ? DISPLAY_EXACT_LIMIT : BOT_EXACT_LIMIT),
    rng: opts.rng,
  });
  const odds = potOdds(view);
  const required = requiredEquity(odds);
  return {
    equity,
    potOdds: odds,
    requiredEquity: required,
    effectiveStack: effectiveStack(view),
    spr: spr(view),
    position: position(view),
    verdict: required === null ? null : equity.value >= required ? 'call_ok' : 'call_short',
    basis: 'vs_random_hands',
  };
}

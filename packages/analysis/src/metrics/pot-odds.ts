// Pot odds and required equity (SS20): P : C and C / (P + C).
//
// P is summed from the public action log (`added` = chips newly put in, blinds included as post_sb/post_bb)
// rather than from `inHand.committed`, because the contract fixes the meaning of `added` and leaves `committed`
// undocumented. At any decision point nothing has been returned yet (uncalled bets are only returned when the
// betting round ends), so the sum equals "the pot before my call, this street's bets included".
import type { MetricsView } from '../bot/contract';

/** Every chip put in this hand so far (blinds and the current street's bets included). */
export function potSize(view: Pick<MetricsView, 'hand'>): number {
  let pot = 0;
  for (const a of view.hand?.actions ?? []) pot += a.added;
  return pot;
}

export function potOdds(view: MetricsView): { pot: number; call: number } | null {
  const call = view.me.legal?.call ?? null;
  if (call === null || view.hand === null) return null;
  return { pot: potSize(view), call: call.amount };
}

export function requiredEquity(odds: { pot: number; call: number } | null): number | null {
  return odds === null ? null : odds.call / (odds.pot + odds.call);
}

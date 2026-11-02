// Bot turns (SS14, bot.io.v1 worker_rules — R0 part). A bot acts once BOTH its decision has arrived (BOT_DECISION;
// rule bots decide inside the Worker right away) and its thinking delay has elapsed (TIMER bot:<reqId>).
// A decision for an older request, or for a turn that already moved on, is ignored.
// An illegal decision falls back to "check if possible, else fold" (the SS9 safe default) and reports
// E-ACT-ILLEGAL as a non-fatal W.ERROR; 3-1 replaces this with nearestLegal correction.
import { applyActionWith } from '../hand/apply';
import { legalActions } from '../hand/legal';
import type { EngineAction } from '../protocol/view-types';
import { CheckyError } from '../util/checky-error';
import { afterHand, guardInvariant } from './between-hands';
import type { Effect, ReduceCtx, TableBotDecision, TableState } from './state';

function toAction(seat: number, d: TableBotDecision): EngineAction {
  if (d.action === 'fold' || d.action === 'check' || d.action === 'call') return { seat, type: d.action };
  return d.amount === null ? { seat, type: d.action } : { seat, type: d.action, to: d.amount };
}

/** Apply the pending bot decision if it is ready. Mutates `t` (a clone). */
export function maybeApplyBot(t: TableState, fx: Effect[], ctx: ReduceCtx): void {
  const pending = t.pendingBot;
  const hand = t.hand;
  if (pending === null || !pending.thinkDone || !pending.arrived || hand === null) return;
  if (hand.handId !== pending.handId || hand.turnSeq !== pending.turnSeq || hand.toAct !== pending.seat) {
    t.pendingBot = null;
    return;
  }
  t.pendingBot = null;
  guardInvariant(t, fx, () => {
    const safe = (): ReturnType<typeof applyActionWith> =>
      applyActionWith(hand, { seat: pending.seat, type: legalActions(hand, pending.seat)!.check ? 'check' : 'fold' }, undefined);
    let applied;
    if (pending.decision === null) {
      applied = safe();
    } else {
      try {
        applied = applyActionWith(hand, toAction(pending.seat, pending.decision), undefined);
      } catch (e) {
        if (!(e instanceof CheckyError) || e.code === 'E-ENG-INVARIANT') throw e;
        fx.push({ t: 'ERROR', code: 'E-ACT-ILLEGAL' });
        applied = safe();
      }
    }
    t.hand = applied.state;
    afterHand(t, fx, ctx, applied.events);
  });
}

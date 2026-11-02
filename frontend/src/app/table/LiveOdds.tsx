// LiveOdds for practice (components.md 3.12, ui-spec 0.5, US20). Shows only DecisionMetrics from the metrics Worker
// (computeMetricsAsync(view, 'display')) — the screen computes no equity.
//
// When: once per new turn of mine (hand id + turnSeq with toAct = me); snapshots that only move the clock do not
// recompute, and a result for an older turn is dropped. Off (PR-01 / menu toggle) = zero calls.
// States: nothing for the first 300 ms, then "—" in the number slot (no shimmer, so it does not blink every turn);
// pot odds and needed rows only when there is something to call; failure or slowness (E-ANL-SLOW) hides the panel
// until the next turn (silent). An AbortError is not a failure: computeMetricsAsync rejects a request with it when a
// newer request replaces it (Stephen, ml.md D-ML-9), so the panel keeps its state and waits for that newer result.
// SC4: exact -> value only, no badge (T2-005); estimate -> "≈" + "Estimate ±x%" badge. The visible value and badge are
// aria-hidden and one hidden sentence (odds.sr.*) is read instead of relying on "≈".
import { useEffect, useRef, useState } from 'react';
import type { DecisionMetrics, MetricsView } from '@checky/analysis';
import type { PlayerView } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Badge } from '../ui/Badge';
import { Tooltip } from '../ui/Tooltip';
import { equityDisplay, formatInt, formatPercent1, formatPotOdds } from './format';

export type ComputeMetrics = (view: MetricsView) => Promise<DecisionMetrics>;

const PLACEHOLDER_MS = 300;

// DOMException('AbortError') from the metrics client; matched by name so a plain Error named AbortError counts too.
const isAbortError = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';

type State = { kind: 'idle' } | { kind: 'loading'; showDash: boolean } | { kind: 'ready'; metrics: DecisionMetrics } | { kind: 'failed' };

export function LiveOdds({ view, compute, enabled }: { view: PlayerView; compute: ComputeMetrics | undefined; enabled: boolean }) {
  const { t, lang } = useI18n();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const hand = view.hand;
  const myTurn = hand !== null && view.me.seat !== null && hand.toAct === view.me.seat && view.me.legal !== null;
  const turnKey = myTurn ? `${hand.handId}:${hand.turnSeq}` : null;
  // The latest view, read when a new turn starts; not a dependency so clock-only updates never recompute.
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!enabled || compute === undefined || turnKey === null) {
      setState({ kind: 'idle' });
      return undefined;
    }
    let current = true;
    setState({ kind: 'loading', showDash: false });
    const dash = setTimeout(() => current && setState((s) => (s.kind === 'loading' ? { kind: 'loading', showDash: true } : s)), PLACEHOLDER_MS);
    compute(viewRef.current).then(
      (metrics) => current && setState({ kind: 'ready', metrics }),
      (e: unknown) => current && !isAbortError(e) && setState({ kind: 'failed' }),
    );
    return () => {
      current = false; // a late result for this turn is dropped
      clearTimeout(dash);
    };
  }, [enabled, compute, turnKey]);

  if (!enabled || state.kind === 'idle' || state.kind === 'failed') return null;
  if (state.kind === 'loading' && !state.showDash) return null;

  const m = state.kind === 'ready' ? state.metrics : null;
  const d = m ? equityDisplay({ method: m.equity.method, value: m.equity.value, halfWidth95: m.equity.halfWidth95, samples: m.equity.samples }, lang) : null;
  const badge = d?.badgeKey ? (
    <Badge tone="warn" caps={false} aria-hidden="true" data-testid="T-01.oddsBadge">
      {t(d.badgeKey, d.vars)}
    </Badge>
  ) : null;
  return (
    <section aria-label={t('menu.liveOdds')} className="flex w-44 flex-col gap-1 rounded-md bg-raised/90 p-3 text-small shadow-e1" data-testid="T-01.liveOdds">
      <dl className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <dt className="text-muted-foreground">{t('odds.win')}</dt>
          <dd className="flex items-center gap-1">
            <span aria-hidden="true" className="num font-semibold text-foreground">{d ? t(d.valueKey, d.vars) : '—'}</span>
            {badge && d?.tipKey ? (
              <Tooltip content={t(d.tipKey, d.vars)}>
                <span>{badge}</span>
              </Tooltip>
            ) : (
              badge
            )}
            {d ? <span className="sr-only">{t(d.srKey, d.vars)}</span> : null}
          </dd>
        </div>
        {m?.potOdds ? (
          <>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t('odds.potOdds')}</dt>
              <dd className="num">{formatPotOdds(m.potOdds.pot, m.potOdds.call, lang)}</dd>
            </div>
            {m.requiredEquity !== null ? (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t('odds.needed')}</dt>
                <dd className="num">{t('odds.value.exact', { v: formatPercent1(m.requiredEquity, lang) })}</dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>
      {m ? <p className="text-micro text-muted-foreground">{t('odds.vs', { n: formatInt(m.equity.opponents, lang) })}</p> : null}
    </section>
  );
}

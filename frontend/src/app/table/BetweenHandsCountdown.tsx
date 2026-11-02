// BetweenHandsCountdown — the bottom slot's `next` pill (components.md 3.11, ui-spec T-01 pause table; W5 R0-2
// R0-L19: it used to sit on the felt under the pot, where the board cards covered its button — MS-R0-3 D4):
//   BETWEEN_HANDS              -> "Next hand in 5" + Pause (ghost sm; between hands Pause stops at once, F-JN-05)
//   pending pause (defensive)  -> "Pausing before the next hand" instead of the countdown, no button
//   PAUSED, < 2 seated w/chips -> "Waiting for players", no button
//   PAUSED                     -> "Paused" + Resume (secondary sm)
// The pill's only buttons are Pause and Resume (R0-L25): "Get chips again" is the T-06 card's, "Keep playing" is the
// HUD's and the menu's (a pending pause exists only during a hand, when the slot shows the action bar or Check/Fold).
// When a `next` card (refill, sit-out) takes the slot the pill is not drawn; NextStatus carries its words, without
// the button, onto the card's first line.
import type { PlayerView } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { pauseState } from './format';
import { useTableActions } from './TableActionsContext';
import { secondsOf, useCountdown } from './useCountdown';

const PILL = 'motion-fade-in-base inline-flex items-center gap-3 rounded-pill bg-raised px-4 py-1.5 text-small font-semibold text-foreground shadow-e1';

export function seatedWithChips(view: PlayerView): number {
  return view.seats.filter((s) => s.occupant !== null && s.occupant.stack > 0 && s.occupant.status !== 'LEFT' && s.occupant.status !== 'KICKED').length;
}

/** "Next hand in N" while the countdown runs; frozen in place once the room is paused (motion-spec M-PAUSE). */
function useNextHandText(view: PlayerView): string | null {
  const { t, lang } = useI18n();
  const { phase, paused, countdownMs } = view.room;
  const left = useCountdown(countdownMs, `${view.hand?.handId ?? ''}:${phase}`, pauseState(paused, phase) !== 'running');
  return left === null ? null : t('table.nextHand', { s: new Intl.NumberFormat(lang).format(secondsOf(left)) });
}

/**
 * The status words of a `next` card (components.md 3.11 "status text"): BETWEEN_HANDS "Next hand in N" (the R0-L10
 * refill window), the defensive pending pause "Pausing before the next hand", PAUSED "Paused", a hand in play none.
 */
export function NextStatus({ view }: { view: PlayerView }) {
  const t = useI18n().t;
  const { phase, paused } = view.room;
  const nextHand = useNextHandText(view);
  const text = phase === 'PAUSED' ? t('table.paused.self') : phase !== 'BETWEEN_HANDS' ? null : paused ? t('table.pausing') : nextHand;
  return text === null ? null : <span className="num text-small text-muted-foreground">{text}</span>;
}

export function BetweenHandsCountdown({ view }: { view: PlayerView }) {
  const { t } = useI18n();
  const actions = useTableActions();
  const { phase, paused } = view.room;
  const state = pauseState(paused, phase);
  const nextHand = useNextHandText(view);

  if (state === 'paused') {
    if (seatedWithChips(view) < 2) return <span className={PILL} data-testid="T-01.pausedPill">{t('table.waitingPlayers')}</span>;
    return (
      <span className={PILL} data-testid="T-01.pausedPill">
        {t('table.paused.self')}
        <Button variant="secondary" size="sm" onClick={actions.resume} data-testid="T-01.resumePill">
          {t('table.resume')}
        </Button>
      </span>
    );
  }
  if (phase !== 'BETWEEN_HANDS') return null;
  if (state === 'pending') return <span className={PILL}>{t('table.pausing')}</span>;
  return (
    <span className={PILL} data-testid="T-01.countdown">
      <span className="num">{nextHand}</span>
      <Button variant="ghost" size="sm" onClick={actions.pause} data-testid="T-01.pauseCountdown">
        {t('table.pause')}
      </Button>
    </span>
  );
}

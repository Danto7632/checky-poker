// PotDisplay (components.md 3.6, W5 R0-2): ONE line — "POT" (label-caps) and the displayed total on the same
// baseline — and, with side pots, one micro line under it listing them. The total is settled pots + bets in front
// (display arithmetic, not a rule). Placement and "only while a hand is played" belong to FeltCentre.
import { useI18n } from '../i18n/useT';
import { formatChips } from './format';

export function PotDisplay({ total, pots }: { total: number; pots: readonly { amount: number }[] }) {
  const { t, lang } = useI18n();
  if (total <= 0) return null;
  return (
    <div className="flex flex-col items-center whitespace-nowrap" data-testid="T-01.pot">
      <span className="flex items-baseline gap-2">
        <span className="label-caps text-muted-foreground">{t('table.pot')}</span>
        <span className="num text-title font-bold text-foreground">{formatChips(total, lang)}</span>
      </span>
      {pots.length > 1 ? (
        <span className="num text-micro text-muted-foreground">{pots.map((p) => formatChips(p.amount, lang)).join(' · ')}</span>
      ) : null}
    </div>
  );
}

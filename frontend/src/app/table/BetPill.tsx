// BetPill (components.md 3.7): the chips a seat has in front of it this street, numbers only (G-6); en shortens
// from 10,000 ("12.5k"), ja prints full numbers.
import { useI18n } from '../i18n/useT';
import { formatChips } from './format';

export function BetPill({ amount }: { amount: number }) {
  const { lang } = useI18n();
  if (amount <= 0) return null;
  return (
    <span className="num inline-flex h-6 items-center rounded-pill bg-raised px-2 text-small font-semibold text-foreground shadow-e1">
      {formatChips(amount, lang, true)}
    </span>
  );
}

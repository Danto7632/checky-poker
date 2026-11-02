// Empty seat, participant variant (components.md 3.4): dashed circle + "Open seat", not interactive. The host's
// "Add seat" variant arrives with 2-3.
import { useT } from '../i18n/useT';

export function SeatEmpty({ seat }: { seat: number }) {
  const t = useT();
  return (
    <div data-testid={`T-01.seatEmpty${seat}`} className="flex w-24 flex-col items-center gap-1 md:w-28">
      <span aria-hidden="true" className="size-(--avatar) rounded-pill border border-dashed border-border-strong" />
      <span className="text-micro text-muted-foreground">{t('seat.open')}</span>
    </div>
  );
}

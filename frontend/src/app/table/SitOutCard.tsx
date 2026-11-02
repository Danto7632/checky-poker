// SitOutCard — a `next` card of the bottom slot while I sit out with chips (components.md 3.3, ui-spec T-01 partial
// state, US9 AC3; W5 R0-2: moved out of my-area row for the same below-the-fold reason as T-06 — MS-R0-3 O1). After
// three timeouts in a row the N-SITOUT-STRIKES sentence explains why. "Sit back in" -> sit('in'); in practice this
// also restarts a room that stopped because nobody human was seated (W5-U2 sitout_rule), so the card replaces the
// paused pill and its Resume. No title: the pill's words (NextStatus) sit at the right of the first line. With my
// stack at 0 the slot shows the refill card instead (R0-L3) — that choice is BottomSlot's.
import type { PlayerView } from '@checky/engine/protocol';
import type { ClientNotice } from '@/session';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { NextStatus } from './BetweenHandsCountdown';
import { useTableActions } from './TableActionsContext';

export function SitOutCard({ view, notices }: { view: PlayerView; notices: readonly ClientNotice[] }) {
  const t = useT();
  const { sit } = useTableActions();
  const strikes = notices.some((n) => n.code === 'N-SITOUT-STRIKES');
  return (
    <section className="flex w-full flex-col gap-3 rounded-lg bg-raised p-4 shadow-e2 md:flex-row md:items-center md:gap-4" data-testid="T-01.sitOut">
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
        <p className="text-small text-foreground">{t(strikes ? 'notice.N-SITOUT-STRIKES' : 'table.sitout.body')}</p>
        <NextStatus view={view} />
      </div>
      <Button className="w-full md:min-h-13 md:w-auto md:px-5" onClick={() => sit('in')} data-testid="T-01.sitIn">
        {t('table.sitIn')}
      </Button>
    </section>
  );
}

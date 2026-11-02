// RefillPrompt (components.md 3.11, ui-spec T-06, US3) — a `next` card of the bottom slot (W5 R0-2: it used to sit in
// my-area row, where 1280x757 pushed it below the fold — MS-R0-3 O1). Free and unlimited refills: no counter, no
// purchase wording ("Buy", "Top up", "Get more chips", "Free coins" are banned). It is the ONLY visible refill button
// (R0-L25): the HUD, the felt and my area have none; the menu sheet has its own row. Shape: >= 768 one row —
// [title + status / body] [button lg]; < 768 stacked with a full-width md button. The status on the title row is the
// pill's words it replaces (NextStatus: "Next hand in N" in the R0-L10 window, "Paused" when stopped).
//
// useRefillDone: after a refill the slot shows "You have N chips." for 1.5 s in the same place. It keys on the
// snapshots, not on this button — a refill was on offer (canRefill) and my stack is now above 0 — so the menu row
// confirms the same way. The stack is the table seat stack between hands (R0-L15). E-ROOM-REFILL-NOT-ALLOWED is
// silent. The hook lives in the always-mounted slot because the card itself is gone once canRefill turns false.
import { useEffect, useRef, useState } from 'react';
import type { PlayerView } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { NextStatus } from './BetweenHandsCountdown';
import { formatChips } from './format';
import { useTableActions } from './TableActionsContext';

const DONE_MS = 1500;

/** My stack to confirm ("You have N chips.") for 1.5 s after a refill, else null. */
export function useRefillDone(view: PlayerView): number | null {
  const stack = view.seats.find((s) => s.occupant?.isMe)?.occupant?.stack ?? 0;
  const canRefill = view.me.canRefill;
  const [done, setDone] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // canRefill of the previous snapshot: only a stack that rose while a refill was on offer counts as a refill.
  const offered = useRef(canRefill);

  useEffect(() => {
    const wasOffered = offered.current;
    offered.current = canRefill;
    if (!wasOffered || stack <= 0) return;
    setDone(stack);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), DONE_MS);
  }, [canRefill, stack]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  return done;
}

export function RefillDone({ chips }: { chips: number }) {
  const { t, lang } = useI18n();
  return <p role="status" className="num text-small text-good" data-testid="T-06.done">{t('refill.done', { chips: formatChips(chips, lang) })}</p>;
}

export function RefillPrompt({ view }: { view: PlayerView }) {
  const { t, lang } = useI18n();
  const { refill } = useTableActions();
  return (
    <section className="flex w-full flex-col gap-3 rounded-lg bg-raised p-4 shadow-e2 md:flex-row md:items-center md:gap-4" data-testid="T-06.card">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="text-body font-semibold">{t('refill.title')}</h2>
          <NextStatus view={view} />
        </div>
        <p className="num text-small text-muted-foreground">{t('refill.body', { chips: formatChips(view.room.settings.startStack, lang) })}</p>
      </div>
      <Button variant="primary" className="w-full md:min-h-13 md:w-auto md:px-5" onClick={refill} data-testid="T-06.refill">
        {t('refill.cta')}
      </Button>
    </section>
  );
}

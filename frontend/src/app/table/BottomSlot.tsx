// BottomSlot — TableLayout's `actionBar` slot (components.md 3.1 "bottom slot modes", ui-spec T-01 "felt centre ·
// bottom slot"; W5 R0-2 R0-L19 / R0-L25 / R0-L18). It sits under the scrolling area and always holds what I can do
// next. First match wins:
//   act    my turn (me.legal)                       ActionBar, BetSizer inside   (its own 2 px accent top border)
//   pre    in the hand, not my turn, not all-in     Check/Fold toggle row
//   next   1.5 s after a refill                     "You have N chips."          (T-06.done)
//          me.canRefill                             RefillPrompt card            (the screen's only refill button)
//          sitting out with chips                   SitOutCard
//          sitting out, 0 chips, no refill offer    "You're sitting out until you get chips."
//          between hands or paused                  BetweenHandsCountdown pill  (Pause / Resume only)
//   empty  anything else                            nothing; the minimum height stays so the felt does not jump
// Being outside the scroll area, a card is on screen without scrolling at every width (MS-R0-3 O1), and no button
// of the slot can sit under the board (D4). A mode change fades the new content in (M-SLOT, --dur-base) and never
// moves focus.
//
// Table toasts (components.md 1.10, R0-L18 / MS-R0-3 D5): while the table is up, `--toast-bottom` on :root is this
// slot's border-box height + 16 px, so a toast floats just above whatever the slot holds — an opened BetSizer lifts it
// too (ResizeObserver). `data-table-toasts` on :root makes toasts click-through (theme.css), so even a toast that
// overlaps something never takes a click or a hover (hover used to freeze it for minutes over the confirm button).
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import type { PlayerView } from '@checky/engine/protocol';
import type { ClientNotice } from '@/session';
import { useT } from '../i18n/useT';
import { BetweenHandsCountdown } from './BetweenHandsCountdown';
import { RefillDone, RefillPrompt, useRefillDone } from './RefillPrompt';
import { SitOutCard } from './SitOutCard';

export type SlotMode = 'act' | 'pre' | 'next' | 'empty';

export interface BottomSlotProps {
  view: PlayerView;
  notices: readonly ClientNotice[];
  /** The ActionBar when it is my turn, else null. */
  act: ReactNode;
  /** The Check/Fold row while I am in the hand and waiting, else null. */
  pre: ReactNode;
}

/** Keeps --toast-bottom (and click-through toasts) in step with the slot while it is mounted. */
function useToastsAbove(slot: RefObject<HTMLDivElement | null>): void {
  useLayoutEffect(() => {
    const el = slot.current;
    if (el === null) return undefined;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--toast-bottom', `calc(${el.getBoundingClientRect().height}px + var(--s-4))`);
    measure();
    root.dataset.tableToasts = '';
    // Every supported browser has ResizeObserver; the guard only keeps environments without layout from throwing.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--toast-bottom');
      delete root.dataset.tableToasts;
    };
  }, [slot]);
}

function MissedLine() {
  const t = useT();
  return <p className="text-small text-muted-foreground" data-testid="T-06.missed">{t('refill.missed')}</p>;
}

/** The mode, a key for the content (a new key replays the fade-in) and the content — the table above, in order. */
function pick({ view, notices, act, pre }: BottomSlotProps, done: number | null): [SlotMode, string, ReactNode] {
  if (act !== null) return ['act', 'act', act];
  if (pre !== null) return ['pre', 'pre', pre];
  if (done !== null) return ['next', 'done', <RefillDone chips={done} />];
  if (view.me.canRefill) return ['next', 'refill', <RefillPrompt view={view} />];
  if (view.me.status === 'SITTING_OUT') {
    const stack = view.seats.find((s) => s.occupant?.isMe)?.occupant?.stack ?? 0;
    return stack > 0 ? ['next', 'sitOut', <SitOutCard view={view} notices={notices} />] : ['next', 'missed', <MissedLine />];
  }
  if (view.room.phase === 'BETWEEN_HANDS' || view.room.phase === 'PAUSED') return ['next', 'pill', <BetweenHandsCountdown view={view} />];
  return ['empty', 'empty', null];
}

export function BottomSlot(props: BottomSlotProps) {
  const ref = useRef<HTMLDivElement>(null);
  useToastsAbove(ref);
  const done = useRefillDone(props.view);
  const [mode, key, content] = pick(props, done);
  return (
    <div ref={ref} className="flex min-h-29 flex-col md:min-h-28" data-testid="T-01.slot" data-mode={mode}>
      {mode === 'act' ? (
        content
      ) : (
        <div key={key} className="motion-fade-in-base flex flex-1 border-t border-border bg-surface px-3 pt-3 pb-[max(var(--s-3),env(safe-area-inset-bottom))] md:px-6">
          <div className="mx-auto flex w-full max-w-160 items-center justify-center">{content}</div>
        </div>
      )}
    </div>
  );
}

// TableMenu, practice sections (components.md 3.14, ui-spec T-05): Room (blinds, starting chips, time per turn, the
// play-money line) · Game (Pause/Resume following the pause table, Live odds, Bot chatter — setOption, MA-R1-07) ·
// You (Leave table) · Help (Keyboard shortcuts). No lock, kick or invite in practice.
// Every state row closes the sheet when pressed — Pause, Keep playing (lead review 4 D-R3-2: below 768 the open sheet
// covered the action bar while my turn clock ran), Resume, Get chips again, Leave.
// Pressing Pause here during a hand also toasts "Pausing before the next hand" once, because the sheet closes and
// the HUD label is not in view (ui-spec T-01). Keep playing has no toast: TableAnnouncer reads "Pause cancelled".
// The Pause row says "Pause after this hand" during a hand and plain "Pause" between hands, where it stops at once.
// Stopped with my stack at 0 (format.mustRefill, R0-L3), the Resume row becomes the sheet's one "Get chips again" with
// the "free, as many times as you like" sentence under it (R0-L25); it refills and closes the sheet, and "You have N
// chips." shows in the bottom slot. In the refill window between hands the row stays Pause: the slot's card is in view.
import { useId } from 'react';
import { Hourglass } from 'lucide-react';
import type { PlayerView } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Sheet } from '../ui/Sheet';
import { showToast } from '../ui/Toast';
import { Toggle } from '../ui/Toggle';
import { formatChips, mustRefill, pauseState } from './format';
import { useTableActions } from './TableActionsContext';

export interface TableMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: PlayerView;
  liveOdds: boolean;
  onLiveOdds: (on: boolean) => void;
  shortcuts: boolean;
  onShortcuts: (on: boolean) => void;
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="label-caps pt-2 text-muted-foreground">{children}</h3>;
}

export function TableMenu({ open, onOpenChange, view, liveOdds, onLiveOdds, shortcuts, onShortcuts }: TableMenuProps) {
  const { t, lang } = useI18n();
  const actions = useTableActions();
  const { settings, paused, phase } = view.room;
  const state = pauseState(paused, phase);
  const close = () => onOpenChange(false);
  const refillBodyId = useId();
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('table.menu.open')} closeLabel={t('common.close')} testId="T-05.sheet">
      <div className="flex flex-col gap-3">
        <SectionTitle>{t('menu.room')}</SectionTitle>
        <ul className="num flex flex-col gap-1 text-body">
          <li>{t('menu.blinds', { sb: formatChips(settings.sb, lang), bb: formatChips(settings.bb, lang) })}</li>
          <li>{t('menu.stack', { chips: formatChips(settings.startStack, lang) })}</li>
          <li>{settings.turnSeconds === null ? t('menu.turn.none') : t('menu.turn', { s: String(settings.turnSeconds) })}</li>
          <li className="text-small text-muted-foreground">{t('menu.noCash')}</li>
        </ul>

        <SectionTitle>{t('menu.game')}</SectionTitle>
        {state === 'running' ? (
          <Button
            onClick={() => {
              actions.pause();
              if (phase === 'IN_HAND') showToast(t('table.pausing'));
              close();
            }}
            data-testid="T-05.pause"
          >
            {t(phase === 'IN_HAND' ? 'menu.pause' : 'table.pause')}
          </Button>
        ) : state === 'pending' ? (
          <div className="flex flex-col gap-2">
            <p className="flex items-center gap-2 text-small text-muted-foreground">
              <Hourglass aria-hidden="true" width={16} height={16} />
              {t('table.pausing')}
            </p>
            <Button
              onClick={() => {
                actions.resume();
                close();
              }}
              data-testid="T-05.keepPlaying"
            >
              {t('table.keepPlaying')}
            </Button>
          </div>
        ) : mustRefill(view) ? (
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => {
                actions.refill();
                close();
              }}
              aria-describedby={refillBodyId}
              data-testid="T-05.refill"
            >
              {t('refill.cta')}
            </Button>
            <p id={refillBodyId} className="num text-small text-muted-foreground">
              {t('refill.body', { chips: formatChips(settings.startStack, lang) })}
            </p>
          </div>
        ) : (
          <Button
            onClick={() => {
              actions.resume();
              close();
            }}
            data-testid="T-05.resume"
          >
            {t('menu.resume')}
          </Button>
        )}
        <Toggle label={t('menu.liveOdds')} checked={liveOdds} onCheckedChange={onLiveOdds} testId="T-05.liveOdds" />
        <Toggle
          label={t('menu.chatter')}
          description={t(settings.botChatter ? 'menu.chatter.on' : 'menu.chatter.off')}
          checked={settings.botChatter}
          onCheckedChange={(on) => actions.setOption({ botChatter: on })}
          testId="T-05.chatter"
        />

        <SectionTitle>{t('menu.you')}</SectionTitle>
        <Button
          onClick={() => {
            close();
            actions.requestLeave();
          }}
          data-testid="T-05.leave"
        >
          {t('menu.leave')}
        </Button>

        <SectionTitle>{t('menu.help')}</SectionTitle>
        <Toggle label={t('menu.shortcuts')} checked={shortcuts} onCheckedChange={onShortcuts} testId="T-05.shortcuts" />
      </div>
    </Sheet>
  );
}

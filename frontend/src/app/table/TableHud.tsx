// TableHud, practice variant (components.md 3.14, ui-spec T-01): Leave · room chip "Practice · 50/100" (no code, no
// connection dot) · PauseControl in the connection dot's place (>= 768) · menu button. No refill button (R0-L25).
import { ArrowLeft, Menu } from 'lucide-react';
import type { PlayerView } from '@checky/engine/protocol';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { formatChips, mustRefill } from './format';
import { PauseControl } from './PauseControl';
import { useTableActions } from './TableActionsContext';

export function TableHud({ view, onOpenMenu }: { view: PlayerView; onOpenMenu: () => void }) {
  const { t, lang } = useI18n();
  const actions = useTableActions();
  const { sb, bb } = view.room.settings;
  return (
    <header className="z-(--z-hud) flex h-12 items-center justify-between gap-4 border-b border-border bg-background px-2 md:h-14 md:px-4">
      <Button variant="ghost" size="sm" icon={<ArrowLeft aria-hidden="true" width={20} height={20} />} onClick={actions.requestLeave} data-testid="T-01.leave">
        {t('table.leave')}
      </Button>
      <span className="num truncate rounded-pill border border-border px-3 py-1 text-small text-muted-foreground" data-testid="T-01.roomChip">
        {t('table.roomChip.practice', { sb: formatChips(sb, lang), bb: formatChips(bb, lang) })}
      </span>
      <div className="flex items-center gap-2">
        <PauseControl
          paused={view.room.paused}
          phase={view.room.phase}
          mustRefill={mustRefill(view)}
          onPause={actions.pause}
          onResume={actions.resume}
        />
        <IconButton label={t('table.menu.open')} icon={<Menu width={20} height={20} />} onClick={onOpenMenu} data-testid="T-01.menu" />
      </div>
    </header>
  );
}

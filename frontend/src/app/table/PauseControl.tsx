// PauseControl for practice (components.md 3.15, ui-spec T-01 "pause — practice", contract pause_rule.practice
// 1.0.4-p1). State comes only from the next snapshot (pauseState(room.paused, room.phase)) — no optimistic label.
//
//   running -> Pause button                       -> pause()
//   pending -> "Pausing before the next hand" + Keep playing (enabled: RESUME cancels the pending pause, F-JN-05)
//   paused  -> Resume button                      -> resume()
//   paused with my stack at 0 (mustRefill = `needsChips`, R0-L3) -> nothing at all. The engine drops RESUME until I
//              refill, so Resume would be a button that does nothing; and the refill is not drawn here either
//              (R0-L25): the bottom slot's T-06 card, with its "free, as many times as you like" sentence, is the
//              one refill button — a bare "Get chips again" in the HUD reads like a shop button.
//
// Placement "hud": >= 1024 ghost sm with icon + label, 768-1023 icon only (same accessible name), < 768 not rendered
// (the menu and the countdown carry it). No aria-pressed: the label already changes and "Resume, pressed" would be
// read twice. Errors from pause()/resume() are silent (errors.v1).
import { Hourglass, Pause, Play } from 'lucide-react';
import type { RoomPhase } from '@checky/engine/protocol';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { pauseState } from './format';

export interface PauseControlProps {
  paused: boolean;
  phase: RoomPhase;
  /** format.mustRefill(view): practice stopped with my stack at 0. */
  mustRefill: boolean;
  onPause: () => void;
  onResume: () => void;
}

export function PauseControl({ paused, phase, mustRefill, onPause, onResume }: PauseControlProps) {
  const t = useT();
  const state = pauseState(paused, phase);
  if (state === 'paused' && mustRefill) return null;
  const action =
    state === 'running'
      ? { label: t('table.pause'), icon: <Pause width={20} height={20} />, onClick: onPause }
      : state === 'pending'
        ? { label: t('table.keepPlaying'), icon: <Play width={20} height={20} />, onClick: onResume }
        : { label: t('table.resume'), icon: <Play width={20} height={20} />, onClick: onResume };
  return (
    <div className="hidden items-center gap-2 md:flex" data-testid="T-01.pauseControl" data-state={state}>
      {state === 'pending' ? (
        <span className="hidden items-center gap-1 text-small text-muted-foreground lg:inline-flex">
          <Hourglass aria-hidden="true" width={16} height={16} />
          {t('table.pausing')}
        </span>
      ) : null}
      <span className="hidden lg:inline-flex">
        <Button variant="ghost" size="sm" icon={action.icon} onClick={action.onClick} data-testid="T-01.pauseButton">
          {action.label}
        </Button>
      </span>
      <span className="lg:hidden">
        <IconButton label={action.label} icon={action.icon} onClick={action.onClick} />
      </span>
    </div>
  );
}

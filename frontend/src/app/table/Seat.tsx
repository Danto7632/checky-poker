// Seat (components.md 3.3). Visual state from format.seatVisualState; the turn ring only when `turn` is not null
// (seatTurnClock). My turn adds the --e-turn glow and the accent name plate even without a clock (No limit): the
// turn signal and the time signal are separate.
//
// a11y: <section aria-label> = seat.sr + tail (", to act", ", N seconds left" only with a clock, the status chip).
// Live changes are announced by TableAnnouncer, not by this label.
import { clsx } from 'clsx';
import type { ActionLogEntry, Occupant } from '@checky/engine/protocol';
import { BotAvatar } from '../bots/BotAvatar';
import { PlayingCard } from '../cards/PlayingCard';
import { useI18n, type MessageKey } from '../i18n/useT';
import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { formatChips, formatDelta, seatVisualState, type SeatVisualState, type TurnClock } from './format';
import { TurnTimer } from './TurnTimer';
import { secondsOf } from './useCountdown';

const STATUS_KEY: Partial<Record<SeatVisualState, MessageKey>> = {
  waitingNext: 'seat.joinsNext',
  sittingOut: 'seat.sittingOut',
  reconnecting: 'seat.reconnecting',
  folded: 'seat.folded',
  allIn: 'seat.allIn',
  thinking: 'seat.thinking',
};

export interface SeatProps {
  seat: number;
  occupant: Occupant;
  isToAct: boolean;
  turn: TurnClock | null;
  turnKey: string;
  frozen: boolean;
  /** format.handInPlay(room.phase): the All-in badge is a live-hand state only (R0-L15). */
  inPlay: boolean;
  lastAction: ActionLogEntry | null;
  isButton: boolean;
  isSB: boolean;
  isBB: boolean;
  wonAmount: number | null;
}

export function Seat({ seat, occupant, isToAct, turn, turnKey, frozen, inPlay, isButton, isSB, isBB, wonAmount }: SeatProps) {
  const { t, lang } = useI18n();
  const state = seatVisualState(occupant, isToAct, inPlay);
  const statusKey = STATUS_KEY[state];
  const mineTurn = occupant.isMe && isToAct;
  const sep = t('common.listSep');
  const tail = [
    isToAct ? t('seat.sr.toAct') : '',
    isToAct && turn !== null ? t('seat.sr.left', { s: String(secondsOf(turn.remainingMs)) }) : '',
    statusKey ? `${sep}${t(statusKey)}` : '',
  ].join('');
  const label = t('seat.sr', { n: String(seat + 1), name: occupant.name, chips: formatChips(occupant.stack, lang), status: tail });
  const cards = occupant.inHand?.cards ?? null;
  return (
    <section
      aria-label={label}
      data-testid={`T-01.seat${seat}`}
      className={clsx(
        'flex w-24 flex-col items-center gap-1 transition-opacity motion-transition md:w-28',
        state === 'folded' && 'opacity-50',
        state === 'sittingOut' && 'opacity-60',
      )}
    >
      <div className={clsx('relative size-(--avatar) rounded-pill', mineTurn && 'shadow-turn', wonAmount !== null && 'ring-2 ring-good')}>
        {occupant.kind === 'bot' ? (
          <BotAvatar seat={seat} size={40} className="size-full" />
        ) : (
          <Avatar name={occupant.name} seed={occupant.avatarSeed} seat={seat} size={48} className="size-full" />
        )}
        <TurnTimer turn={turn} mine={occupant.isMe} turnKey={turnKey} frozen={frozen} />
        {isButton ? (
          <span aria-hidden="true" className="absolute -right-2 -bottom-1 inline-flex size-5.5 items-center justify-center rounded-pill bg-card-face text-micro font-bold text-suit-black">
            D
          </span>
        ) : null}
      </div>
      {cards ? (
        <div className="flex gap-0.5">
          <PlayingCard card={cards[0]} size="mini" />
          <PlayingCard card={cards[1]} size="mini" />
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={clsx(
          'flex w-full flex-col items-center rounded-md border px-1.5 py-0.5',
          occupant.isMe ? 'border-foreground' : 'border-transparent',
          mineTurn ? 'bg-primary-soft' : 'bg-raised',
        )}
      >
        <span className="w-full truncate text-center text-micro font-semibold md:text-small">
          {occupant.name}
          {occupant.isMe ? ` · ${t('seat.you')}` : ''}
        </span>
        <span className="num text-micro text-muted-foreground md:text-small">{formatChips(occupant.stack, lang, true)}</span>
      </div>
      <div aria-hidden="true" className="flex flex-wrap justify-center gap-1">
        {isSB ? <Badge>SB</Badge> : null}
        {isBB ? <Badge>BB</Badge> : null}
        {state === 'thinking' ? <span className="text-micro text-muted-foreground">{t('seat.thinking')}</span> : null}
        {statusKey && state !== 'thinking' ? <Badge tone={state === 'reconnecting' ? 'warn' : 'neutral'} caps={false}>{t(statusKey)}</Badge> : null}
        {wonAmount !== null ? <span className="num text-small font-semibold text-good">{formatDelta(wonAmount, lang)}</span> : null}
      </div>
    </section>
  );
}

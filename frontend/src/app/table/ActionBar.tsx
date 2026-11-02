// ActionBar (components.md 3.8) — buttons of equal weight (secondary): Fold · Check or Call · Bet…/Raise…, or All-in
// in the third slot when sizing is closed but all-in still puts in more than a call (format.separateAllIn, lead R0
// M2 — otherwise Call is the all-in and the slot stays empty). Only legal actions are drawn (US8 AC1); amounts come
// from view.me.legal. Above them: "Your turn · 24s" (only "Your turn" when turn === null — practice No limit) and
// "To call · Pot". A rejected act() shows an inline critical banner above the bar and changes nothing else (US8 AC3);
// a rejected promise (Worker gone) only releases the buttons. Shortcuts F / C / B·R / Enter / Esc.
import { useState } from 'react';
import type { EngineAction, LegalActions } from '@checky/engine/protocol';
import type { Ack } from '@/session';
import { useI18n, type MessageKey } from '../i18n/useT';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Kbd } from '../ui/Kbd';
import { BetSizer } from './BetSizer';
import { formatChips, separateAllIn, sizerRange, type TurnClock } from './format';
import { secondsOf, useCountdown } from './useCountdown';
import { useShortcuts } from './useShortcuts';

type ActErrorCode = 'E-ACT-NOT-YOUR-TURN' | 'E-ACT-ILLEGAL' | 'E-ACT-AMOUNT';
const ERROR_KEY: Record<ActErrorCode, MessageKey> = {
  'E-ACT-NOT-YOUR-TURN': 'act.err.notYourTurn',
  'E-ACT-ILLEGAL': 'act.err.illegal',
  'E-ACT-AMOUNT': 'sizer.err.min',
};
const isActError = (code: string): code is ActErrorCode => code in ERROR_KEY;

export interface ActionBarProps {
  legal: LegalActions;
  seat: number;
  pot: number;
  myBet: number;
  bb: number;
  turn: TurnClock | null;
  turnKey: string;
  shortcuts: boolean;
  onAct: (action: EngineAction) => Promise<Ack>;
}

export function ActionBar({ legal, seat, pot, myBet, bb, turn, turnKey, shortcuts, onAct }: ActionBarProps) {
  const { t, lang } = useI18n();
  // The action type waiting for its Ack (<= 1 s, DV21): every button is blocked, the pressed one shows a spinner.
  const [pending, setPending] = useState<EngineAction['type'] | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<ActErrorCode | null>(null);
  const [sizing, setSizing] = useState(false);
  const left = useCountdown(turn?.remainingMs ?? null, turnKey);
  const range = sizerRange(legal);
  const toCall = legal.call?.amount ?? 0;

  const send = (action: EngineAction) => {
    if (busy) return;
    setPending(action.type);
    setError(null);
    void onAct(action).then(
      (ack) => {
        setPending(null);
        // E-ACT-STALE and other codes are silent (errors.v1); only the three inline codes show.
        if (!ack.ok && isActError(ack.code)) setError(ack.code);
        if (ack.ok) setSizing(false);
      },
      // act() resolves by contract; a rejection (Worker gone) must not leave every button blocked for the turn. The
      // crash screen, if any, comes from the client's own state.
      () => setPending(null),
    );
  };
  const fold = () => legal.fold && send({ seat, type: 'fold' });
  const checkOrCall = () => (legal.check ? send({ seat, type: 'check' }) : legal.call ? send({ seat, type: 'call' }) : undefined);
  const openSizer = () => range !== null && setSizing(true);
  useShortcuts(shortcuts && !sizing, { f: fold, c: checkOrCall, b: openSizer, r: openSizer });
  useShortcuts(shortcuts && sizing, { Escape: () => setSizing(false) });

  const errorText = error === null ? null : error === 'E-ACT-AMOUNT' && range ? t(range.kind === 'raise' ? 'sizer.err.min' : 'sizer.err.minBet', { n: formatChips(range.min, lang) }) : t(ERROR_KEY[error]);
  return (
    <div className="motion-fade-in-base flex flex-col gap-2 border-t-2 border-primary bg-surface px-3 pt-3 pb-[max(var(--s-3),env(safe-area-inset-bottom))] md:px-6" data-testid="T-01.actionBar" data-motion="move">
      {errorText ? <Banner tone="critical" testId="T-01.actError">{errorText}</Banner> : null}
      <div className="flex items-center justify-between gap-2 text-small">
        <span className="font-semibold text-primary">
          {t('table.yourTurn')}
          {turn !== null && left !== null ? <span className="num"> · {t('table.secondsLeft', { s: String(secondsOf(left)) })}</span> : null}
        </span>
        <span className="num text-muted-foreground">
          {toCall > 0 ? `${t('table.toCall', { n: formatChips(toCall, lang) })} · ` : ''}
          {t('table.pot')} {formatChips(pot, lang)}
        </span>
      </div>
      {sizing && range ? (
        <BetSizer legal={legal} range={range} seat={seat} pot={pot} myBet={myBet} bb={bb} busy={busy} onAct={send} onBack={() => setSizing(false)} />
      ) : (
        <div className="grid grid-flow-col auto-cols-fr gap-2">
          {legal.fold ? (
            <Button size="xl" className="md:min-h-13" disabled={busy && pending !== 'fold'} loading={pending === 'fold'} onClick={fold} data-testid="T-01.fold">
              {t('table.fold')} {shortcuts ? <Kbd>F</Kbd> : null}
            </Button>
          ) : null}
          {legal.check ? (
            <Button size="xl" className="md:min-h-13" disabled={busy && pending !== 'check'} loading={pending === 'check'} onClick={checkOrCall} data-testid="T-01.check">
              {t('table.check')} {shortcuts ? <Kbd>C</Kbd> : null}
            </Button>
          ) : legal.call ? (
            <Button size="xl" className="md:min-h-13" disabled={busy && pending !== 'call'} loading={pending === 'call'} onClick={checkOrCall} data-testid="T-01.call">
              <span className="num">{t('table.call', { n: formatChips(legal.call.amount, lang) })}</span> {shortcuts ? <Kbd>C</Kbd> : null}
            </Button>
          ) : null}
          {range ? (
            <Button size="xl" className="md:min-h-13" disabled={busy} onClick={openSizer} data-testid={range.kind === 'raise' ? 'T-01.raise' : 'T-01.bet'}>
              {t(range.kind === 'raise' ? 'table.raise' : 'table.bet')} {shortcuts ? <Kbd>R</Kbd> : null}
            </Button>
          ) : separateAllIn(legal, myBet) ? (
            <Button size="xl" className="md:min-h-13" disabled={busy && pending !== 'allin'} loading={pending === 'allin'} onClick={() => send({ seat, type: 'allin', to: legal.allIn.to })} data-testid="T-01.allIn">
              <span className="num">{t('sizer.allIn', { n: formatChips(legal.allIn.to, lang) })}</span>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

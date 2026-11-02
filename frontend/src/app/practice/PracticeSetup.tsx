// PR-01 practice setup (FS-PRAC-1, US18/US19, AF-01). Defaults: 3 bots · Balanced · Time per turn 60 s · live odds on
// · blinds 50/100 · 100 BB, so Home -> Practice -> "Deal me in" is two clicks (US18 AC1).
//
// Turn-time choices and the default come from config defaults.DV4.practice ({options: [30, 60, null], default: 60});
// null is "No limit" (practice only, D28) and adds the help sentence below the control (aria-describedby). The bot
// type control (House/AI) is not rendered in R0-R1 (D-P11: every practice bot is a house rule bot); "Mixed" style
// is reserved and not rendered (D-A8).
//
// "Works offline once this page has loaded" is a promise, so it is drawn only when `offlineReady` says the shell
// warm-up has settled without an error and both Workers answered (R0-L27, R0-L36): not while it runs, not after it
// failed. The line keeps its place either way (visibility, not removal), so "Deal me in" never moves when the
// sentence appears (no layout shift).
import { useId, useState } from 'react';
import type { BotSpec, BotStyle, RoomSettings, TurnSeconds } from '@checky/engine/protocol';
import { defaults } from '@/config';
import { useI18n } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Segmented';
import { Toggle } from '../ui/Toggle';

export interface PracticeChoice {
  bots: number;
  style: BotStyle;
  turnSeconds: TurnSeconds;
  liveOdds: boolean;
}

const BOT_COUNTS = ['1', '2', '3', '4', '5'] as const;
const STYLES: readonly BotStyle[] = ['balanced', 'aggressive', 'tight'];
const turnValue = (s: TurnSeconds): string => (s === null ? 'none' : String(s));

export function defaultChoice(liveOdds: boolean, last: readonly BotSpec[] | null): PracticeChoice {
  return {
    bots: last && last.length >= 1 && last.length <= 5 ? last.length : 3,
    style: last?.[0]?.style ?? 'balanced',
    turnSeconds: defaults.DV4.practice.default,
    liveOdds,
  };
}

/** Contract objects for createPracticeClient. seatCount is informative only: session uses bots.length + 1. */
export function practiceRequest(choice: PracticeChoice, houseName: (n: number) => string): { settings: RoomSettings; bots: BotSpec[] } {
  const settings: RoomSettings = {
    seatCount: choice.bots + 1,
    sb: defaults.DV2.sb,
    bb: defaults.DV2.bb,
    startStack: defaults.DV2.bb * defaults.DV3.defaultBb,
    turnSeconds: choice.turnSeconds,
    liveEquity: choice.liveOdds,
    botChatter: true,
  };
  const bots: BotSpec[] = Array.from({ length: choice.bots }, (_, i) => ({
    engine: 'rule',
    style: choice.style,
    provider: null,
    model: null,
    label: houseName(i + 1),
  }));
  return { settings, bots };
}

export function PracticeSetup({ initial, busy, offlineReady, onStart }: {
  initial: PracticeChoice;
  busy: boolean;
  offlineReady: boolean;
  onStart: (choice: PracticeChoice) => void;
}) {
  const { t, lang } = useI18n();
  const [choice, setChoice] = useState(initial);
  const helpId = useId();
  const turnOptions = defaults.DV4.practice.options.map((s) =>
    s === null
      ? { value: 'none', label: t('practice.turn.none'), testId: 'PR-01.turnNone' }
      : { value: String(s), label: t('create.turn.opt', { s: new Intl.NumberFormat(lang).format(s) }), srLabel: t('create.turn.opt.sr', { s: String(s) }), testId: `PR-01.turn${s}` },
  );
  return (
    <main className="motion-fade-in flex min-h-dvh items-start justify-center bg-background px-4 py-8 md:items-center">
      <section className="flex w-full max-w-gate flex-col gap-5 rounded-lg bg-surface p-6 shadow-e2" data-testid="PR-01.card">
        <h1 className="text-title font-semibold">{t('practice.title')}</h1>
        <Segmented
          label={t('practice.bots')}
          options={BOT_COUNTS.map((n) => ({ value: n, label: n, testId: `PR-01.bots${n}` }))}
          value={String(choice.bots) as (typeof BOT_COUNTS)[number]}
          onChange={(v) => setChoice((c) => ({ ...c, bots: Number(v) }))}
        />
        <Segmented
          label={t('practice.style')}
          options={STYLES.map((s) => ({ value: s, label: t(`style.${s}`) }))}
          value={choice.style}
          onChange={(style) => setChoice((c) => ({ ...c, style }))}
        />
        <Segmented
          label={t('practice.turn')}
          options={turnOptions}
          value={turnValue(choice.turnSeconds)}
          onChange={(v) => setChoice((c) => ({ ...c, turnSeconds: v === 'none' ? null : v === '30' ? 30 : 60 }))}
          describedBy={choice.turnSeconds === null ? helpId : undefined}
        />
        {choice.turnSeconds === null ? (
          <p id={helpId} className="-mt-3 text-small text-muted-foreground" data-testid="PR-01.noLimitHelp">
            {t('practice.turn.none.help')}
          </p>
        ) : null}
        <Toggle label={t('practice.liveOdds')} checked={choice.liveOdds} onCheckedChange={(liveOdds) => setChoice((c) => ({ ...c, liveOdds }))} testId="PR-01.liveOdds" />
        <p className={`text-small text-muted-foreground${offlineReady ? '' : ' invisible'}`} data-testid="PR-01.offline">
          {t('practice.offline')}
        </p>
        <Button variant="primary" size="lg" loading={busy} onClick={() => onStart(choice)} data-testid="PR-01.dealIn">
          {t('practice.cta')}
        </Button>
      </section>
    </main>
  );
}

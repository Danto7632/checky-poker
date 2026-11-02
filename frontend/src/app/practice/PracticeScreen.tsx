// /practice route (R-PRACTICE): PR-01 setup -> T-01 practice table. Loaded lazily behind GateRoute, and it reaches
// session/ai only through composition.loadGameServices(), so neither is evaluated before the gate. What the flow can
// still fetch — game services, both Workers, the font subsets — is warmed once per tab by the shell around every
// gated route (practice/warmup.ts PracticeWarmup, R0-L12 / R0-L13 / R0-L29); PR-01 only reads its status and draws
// "Works offline once this page has loaded" when it is ready (R0-L27).
//
// Client lifecycle: created on "Deal me in" with a profile snapshot taken at that moment (US2 AC3); disposed exactly
// once — on Leave (after leave()), on "Start again" (before the new one) and on unmount.
// E-WORKER-CRASH (creation failure, conn.error or closed.reason worker_fatal) -> practice.crash ErrorState with
// "Start again" (same settings, new client) and Leave (-> /app).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { BotSpec, RoomSettings } from '@checky/engine/protocol';
import type { PracticeTableClient } from '@/session';
import { loadGameServices } from '../composition';
import type { GameServices } from '../game-services';
import { useI18n } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/ErrorState';
import { TableScreen } from '../table/TableScreen';
import { useTableClient } from '../table/useTableClient';
import { defaultChoice, PracticeSetup, practiceRequest, type PracticeChoice } from './PracticeSetup';
import { usePracticeOfflineReady } from './warmup';

type Running = { client: PracticeTableClient; game: GameServices };
type Phase = { kind: 'setup' } | { kind: 'starting' } | { kind: 'playing'; run: Running } | { kind: 'crashed' };

function CrashScreen({ onRestart, onLeave }: { onRestart: () => void; onLeave: () => void }) {
  const { t } = useI18n();
  return (
    <main className="min-h-dvh bg-background">
      <ErrorState
        testId="PR-01.crash"
        title={t('practice.crash.title')}
        body={t('practice.crash.body')}
        code="E-WORKER-CRASH"
        detailsLabel={t('fail.details')}
        actions={
          <>
            <Button variant="primary" onClick={onRestart} data-testid="PR-01.crashRestart">
              {t('practice.crash.cta')}
            </Button>
            <Button onClick={onLeave} data-testid="PR-01.crashLeave">
              {t('table.leave')}
            </Button>
          </>
        }
      />
    </main>
  );
}

/** Watches a running client for the fatal Worker states that end a practice table. */
function PlayingTable({ run, liveOdds, onLiveOdds, onLeave, onRestart, onCrash }: {
  run: Running;
  liveOdds: boolean;
  onLiveOdds: (on: boolean) => void;
  onLeave: () => void;
  onRestart: () => void;
  onCrash: () => void;
}) {
  const snap = useTableClient(run.client);
  const fatal = snap.conn.error === 'E-WORKER-CRASH' || snap.closed?.reason === 'worker_fatal';
  useEffect(() => {
    if (fatal) onCrash();
  }, [fatal, onCrash]);
  return <TableScreen client={run.client} computeMetrics={run.game.computeMetrics} liveOdds={liveOdds} onLiveOdds={onLiveOdds} onLeave={onLeave} onRestart={onRestart} />;
}

export default function PracticeScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { services, profile } = useServices();
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [initial, setInitial] = useState<PracticeChoice | null>(null);
  const [liveOdds, setLiveOdds] = useState(true);
  const request = useRef<{ settings: RoomSettings; bots: BotSpec[] } | null>(null);
  const client = useRef<PracticeTableClient | null>(null);

  const disposeClient = useCallback(() => {
    client.current?.dispose();
    client.current = null;
  }, []);
  useEffect(() => disposeClient, [disposeClient]);

  const offlineReady = usePracticeOfflineReady();

  // PR-01 prefill from AppSettings (live odds default true, last bots); defaults if storage is slow or failing.
  useEffect(() => {
    let live = true;
    services.storage.settings
      .get()
      .then((s) => live && setInitial(defaultChoice(s.liveEquityPractice, s.lastPracticeBots)))
      .catch(() => live && setInitial(defaultChoice(true, null)));
    return () => {
      live = false;
    };
  }, [services]);

  const create = useCallback(async () => {
    if (request.current === null || !profile) return;
    disposeClient();
    setPhase({ kind: 'starting' });
    try {
      const game = await loadGameServices(services);
      // Snapshot of the profile right now; with the room language = current UI language (D-A1).
      const created = game.createPractice({ ...request.current, profile: { ...profile } });
      client.current = created;
      setPhase({ kind: 'playing', run: { client: created, game } });
    } catch {
      setPhase({ kind: 'crashed' });
    }
  }, [profile, services, disposeClient]);

  const start = (choice: PracticeChoice) => {
    request.current = practiceRequest(choice, (n) => t('bot.houseName', { n: String(n) }));
    setLiveOdds(choice.liveOdds);
    void services.storage.settings.patch({ liveEquityPractice: choice.liveOdds, lastPracticeBots: request.current.bots }).catch(() => undefined);
    void create();
  };

  const leave = useCallback(() => {
    const c = client.current;
    // leave() resolves by contract; if it rejects anyway (Worker gone) the user still gets home and the rejection is
    // not left unhandled (review m9).
    void (c ? c.leave().catch(() => undefined) : Promise.resolve()).finally(() => {
      disposeClient();
      navigate('/app');
    });
  }, [disposeClient, navigate]);

  const onCrash = useCallback(() => {
    disposeClient();
    setPhase({ kind: 'crashed' });
  }, [disposeClient]);

  const toggleLiveOdds = (on: boolean) => {
    setLiveOdds(on);
    client.current?.setOption({ liveEquity: on });
    void services.storage.settings.patch({ liveEquityPractice: on }).catch(() => undefined);
  };

  if (phase.kind === 'crashed') return <CrashScreen onRestart={() => void create()} onLeave={leave} />;
  if (phase.kind === 'playing') {
    return <PlayingTable run={phase.run} liveOdds={liveOdds} onLiveOdds={toggleLiveOdds} onLeave={leave} onRestart={() => void create()} onCrash={onCrash} />;
  }
  if (initial === null) return null; // settings read is local and fast; no spinner (ui-spec PR-01 loading)
  return <PracticeSetup initial={initial} busy={phase.kind === 'starting'} offlineReady={offlineReady} onStart={start} />;
}

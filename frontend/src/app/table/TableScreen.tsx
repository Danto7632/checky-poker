// TableScreen (T-01, T-02 result, T-05 menu, T-06 refill) — assembly only (design-handoff 4.1, <= 150 lines). One
// subscription (useTableClient); children get props; commands go through TableActionsContext. States: view === null
// -> 300 ms nothing, then skeletons · alert (E-ENG-INVARIANT) -> AlertScreen · else the table (worker crash: PracticeScreen).
// W5 R0-2 (R0-L19): the felt holds seats + FeltCentre (pot on the board) only; whatever can be pressed next lives in
// the bottom slot (BottomSlot), my area row keeps hole cards, live odds and the hand result.
import { useCallback, useMemo, useState } from 'react';
import { defaults } from '@/config';
import type { PracticeTableClient } from '@/session';
import { useI18n } from '../i18n/useT';
import { ConfirmDialog } from '../ui/Dialog';
import { ActionBar } from './ActionBar';
import { AlertScreen } from './AlertScreen';
import { BottomSlot } from './BottomSlot';
import { Felt } from './Felt';
import { FeltCentre } from './FeltCentre';
import { formatChips, inLiveHand, mustRefill, pauseState, potTotal, seatTurnClock } from './format';
import { HandResult } from './HandResult';
import { HoleCards } from './HoleCards';
import { LiveOdds, type ComputeMetrics } from './LiveOdds';
import { PreActionToggle, usePreAction } from './PreActionToggle';
import { SeatRing } from './SeatRing';
import { TableActionsContext, type TableActions } from './TableActionsContext';
import { TableAnnouncer } from './TableAnnouncer';
import { TableHud } from './TableHud';
import { TableLayout } from './TableLayout';
import { TableLoading } from './TableLoading';
import { TableMenu } from './TableMenu';
import { useShortcuts } from './useShortcuts';
import { useTableClient } from './useTableClient';
import { useTimeoutToast } from './useTimeoutToast';

export interface TableScreenProps {
  client: PracticeTableClient;
  computeMetrics: ComputeMetrics | undefined;
  liveOdds: boolean;
  onLiveOdds: (on: boolean) => void;
  /** Leave + dispose + go home (owned by the route screen). */
  onLeave: () => void;
  /** New table with the same settings. */
  onRestart: () => void;
}

export function TableScreen({ client, computeMetrics, liveOdds, onLiveOdds, onLeave, onRestart }: TableScreenProps) {
  const { t, lang } = useI18n();
  const snap = useTableClient(client);
  const view = snap.view;
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(true);

  const actions = useMemo<TableActions>(
    () => ({
      act: (a) => client.act(a),
      sit: (m) => client.sit(m),
      refill: () => client.refill(),
      pause: () => client.pause(),
      resume: () => client.resume(),
      setOption: (o) => client.setOption(o),
      requestLeave: () => (inLiveHand(client.getSnapshot().view) ? setLeaveOpen(true) : onLeave()),
    }),
    [client, onLeave],
  );

  const hand = view?.hand ?? null;
  const legal = view?.me.legal ?? null;
  const seat = view?.me.seat ?? 0;
  const turnKey = hand ? `${hand.handId}:${hand.turnSeq}` : 'none';
  const actPre = useCallback((a: Parameters<TableActions['act']>[0]) => void client.act(a), [client]);
  useTimeoutToast(view);
  const [preOn, setPreOn] = usePreAction({ handId: hand?.handId ?? '', legal, turnKey, seat, onAct: actPre });
  useShortcuts(shortcuts && view !== null, {
    p: () => {
      if (view === null || mustRefill(view)) return; // refill first (R0-L3): RESUME would be dropped
      if (pauseState(view.room.paused, view.room.phase) === 'running') client.pause();
      else client.resume(); // pending -> keep playing (cancel), paused -> resume
    },
  });

  if (snap.alert !== null) {
    return <AlertScreen code={snap.alert.code} onResume={() => client.resume()} onRestart={onRestart} onLeave={onLeave} />;
  }
  if (view === null) return <TableLoading />;

  const mySeatView = view.seats.find((s) => s.occupant?.isMe);
  const me = mySeatView?.occupant ?? null;
  const myTurnClock = mySeatView ? seatTurnClock(mySeatView, hand, view.room.settings, defaults) : null;
  const pot = potTotal(hand, view.seats);
  const inHandNotMyTurn = legal === null && inLiveHand(view) && me?.inHand?.allIn !== true;

  return (
    <TableActionsContext.Provider value={actions}>
      <TableLayout
        seatCards={view.seats.some((s) => (s.occupant?.inHand?.cards ?? null) !== null)}
        seatCount={view.seats.length}
        hud={<TableHud view={view} onOpenMenu={() => setMenuOpen(true)} />}
        felt={
          <Felt>
            <SeatRing view={view} phase={view.room.phase} />
            <FeltCentre view={view} />
          </Felt>
        }
        hero={
          <>
            {view.me.holeCards ? <HoleCards cards={view.me.holeCards} /> : null}
            <LiveOdds view={view} compute={computeMetrics} enabled={liveOdds} />
            <HandResult view={view} />
          </>
        }
        actionBar={
          <BottomSlot
            view={view}
            notices={snap.notices}
            act={legal !== null && me !== null ? <ActionBar legal={legal} seat={seat} pot={pot} myBet={me.inHand?.bet ?? 0} bb={view.room.settings.bb} turn={myTurnClock} turnKey={turnKey} shortcuts={shortcuts} onAct={actions.act} /> : null}
            pre={inHandNotMyTurn ? <PreActionToggle on={preOn} onChange={setPreOn} /> : null}
          />
        }
      />
      <TableMenu open={menuOpen} onOpenChange={setMenuOpen} view={view} liveOdds={liveOdds} onLiveOdds={onLiveOdds} shortcuts={shortcuts} onShortcuts={setShortcuts} />
      <TableAnnouncer view={view} myTurn={legal !== null ? myTurnClock : null} />
      <ConfirmDialog
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
        title={t('leave.title')}
        body={
          <>
            <p>{t('leave.body', { chips: formatChips(view.room.settings.startStack, lang) })}</p>
            {me?.inHand?.allIn ? <p className="mt-2">{t('leave.allIn')}</p> : null}
          </>
        }
        safeLabel={t('leave.stay')}
        confirmLabel={t('leave.cta')}
        onConfirm={onLeave}
        testId="T-01.leaveDialog"
      />
    </TableActionsContext.Provider>
  );
}

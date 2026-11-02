// Table test helpers: views from Phillip's fake scenarios (A-SES-FAKE) and a recording TableActions context.
// Tests only.
import type { ReactElement } from 'react';
import { vi, type Mock } from 'vitest';
import type { PlayerView } from '@checky/engine/protocol';
import { createFakeClient, type FakeClient } from '@/session';
import { TableActionsContext, type TableActions } from '../table/TableActionsContext';
import { renderI18n } from './render';
import type { Lang } from '@checky/engine/protocol';

export function fakeView(scenario: string): PlayerView {
  const view = createFakeClient(scenario).getSnapshot().view;
  if (view === null) throw new Error(`scenario ${scenario} has no view`);
  return view;
}

export type StubActions = { [K in keyof TableActions]: Mock<TableActions[K]> };

export function stubActions(): StubActions {
  return {
    act: vi.fn<TableActions['act']>(() => Promise.resolve({ ok: true })),
    sit: vi.fn<TableActions['sit']>(),
    refill: vi.fn<TableActions['refill']>(),
    pause: vi.fn<TableActions['pause']>(),
    resume: vi.fn<TableActions['resume']>(),
    setOption: vi.fn<TableActions['setOption']>(),
    requestLeave: vi.fn<TableActions['requestLeave']>(),
  };
}

export function renderWithActions(ui: ReactElement, actions: StubActions = stubActions(), lang: Lang = 'en') {
  const wrap = (node: ReactElement) => <TableActionsContext.Provider value={actions}>{node}</TableActionsContext.Provider>;
  const result = renderI18n(wrap(ui), lang);
  return { actions, ...result, rerender: (node: ReactElement) => result.rerender(wrap(node)) };
}

/**
 * Sitting out with chips and no live cards — the real state after the third timeout folded my hand. The fake
 * `sitting-out` fixture keeps my cards, and while I hold live cards the bottom slot's first match is the Check/Fold
 * row (act > pre > next, components.md 3.1), not the sit-out card.
 */
export function sittingOutClient(): FakeClient {
  const base = createFakeClient('sitting-out');
  const snap = base.getSnapshot();
  const v = snap.view!;
  const seats = v.seats.map((x) => (x.occupant?.isMe ? { ...x, occupant: { ...x.occupant, inHand: null } } : x));
  // One stable snapshot object: useSyncExternalStore re-renders forever if getSnapshot returns a new one each call.
  const next = { ...snap, view: { ...v, seats } };
  return { ...base, getSnapshot: () => next };
}

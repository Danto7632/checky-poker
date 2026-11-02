// The screens this story owns, rendered with real providers for the cross-cutting suites (guardrails, test ids,
// axe). Each entry resolves once its content is on screen. Tests only.
import type { ReactElement } from 'react';
import { screen } from '@testing-library/react';
import { vi } from 'vitest';
import type { DecisionMetrics } from '@checky/analysis';
import type { Lang } from '@checky/engine/protocol';
import { createFakeClient } from '@/session';
import { AdultCheckSlot } from '../gate/AdultCheckSlot';
import { AgeBlockedScreen } from '../gate/AgeBlockedScreen';
import { DisclosureScreen } from '../gate/DisclosureScreen';
import { NicknameScreen } from '../gate/NicknameScreen';
import { AppHome } from '../home/AppHome';
import { defaultChoice, PracticeSetup } from '../practice/PracticeSetup';
import { SettingsScreen } from '../settings/SettingsScreen';
import { AppShell } from '../shell/AppShell';
import { BootErrorScreen } from '../shell/BootErrorScreen';
import { NotFoundScreen } from '../shell/NotFoundScreen';
import { TableScreen } from '../table/TableScreen';
import { renderRoutes, type Harness } from './render';
import { sittingOutClient } from './table-fixtures';

export const MC: DecisionMetrics = {
  equity: { value: 0.241, method: 'mc', samples: 10000, halfWidth95: 0.0237, opponents: 3 },
  potOdds: { pot: 6000, call: 2400 },
  requiredEquity: 0.286,
  effectiveStack: 9000,
  spr: null,
  position: { label: 'BTN', inPosition: true },
  verdict: null,
  basis: 'vs_random_hands',
};
export const EXACT: DecisionMetrics = { ...MC, equity: { value: 0.412, method: 'exact', samples: null, halfWidth95: null, opponents: 2 } };

function table(scenario: string, metrics?: DecisionMetrics, client = createFakeClient(scenario)): ReactElement {
  const compute = metrics ? vi.fn(() => Promise.resolve(metrics)) : undefined;
  return <TableScreen client={client} computeMetrics={compute} liveOdds={metrics !== undefined} onLiveOdds={vi.fn()} onLeave={vi.fn()} onRestart={vi.fn()} />;
}

export interface ScreenCase {
  id: string;
  element: () => ReactElement;
  ready: () => Promise<unknown>;
  profile?: null;
}

export const SCREENS: ScreenCase[] = [
  { id: 'G-01', element: () => <DisclosureScreen destination="/practice" onAdult={vi.fn()} onUnderage={vi.fn()} />, ready: () => screen.findByTestId('G-01.card') },
  { id: 'G-02', element: () => <AgeBlockedScreen />, ready: () => screen.findByTestId('G-02.card') },
  { id: 'G-03', element: () => <AdultCheckSlot onContinue={vi.fn()} />, ready: () => screen.findByTestId('G-03.card') },
  { id: 'P-01', element: () => <NicknameScreen />, ready: () => screen.findByTestId('P-01.card'), profile: null },
  { id: 'H-01', element: () => <AppShell><AppHome /></AppShell>, ready: () => screen.findByTestId('H-01.practice') },
  { id: 'S-01', element: () => <AppShell><SettingsScreen /></AppShell>, ready: () => screen.findByTestId('S-01.saved') },
  { id: 'PR-01', element: () => <PracticeSetup initial={defaultChoice(true, null)} busy={false} offlineReady onStart={vi.fn()} />, ready: () => screen.findByTestId('PR-01.card') },
  { id: 'T-01 my turn (mc odds)', element: () => table('practice-my-turn', MC), ready: () => screen.findByTestId('T-01.liveOdds').then(() => screen.findByTestId('T-01.oddsBadge')) },
  { id: 'T-01 my turn (exact odds)', element: () => table('practice-my-turn', EXACT), ready: () => screen.findByText(/41\.2%/) },
  { id: 'T-01 no limit', element: () => table('practice-no-limit'), ready: () => screen.findByTestId('T-01.actionBar') },
  { id: 'T-01 pausing', element: () => table('practice-pausing'), ready: () => screen.findByTestId('T-01.pauseControl') },
  { id: 'T-01 paused', element: () => table('practice-paused'), ready: () => screen.findByTestId('T-01.pausedPill') },
  { id: 'T-01 paused, refill first (R0-L3, R0-L25)', element: () => table('practice-busted'), ready: () => screen.findByTestId('T-06.refill') },
  { id: 'T-02 showdown', element: () => table('showdown'), ready: () => screen.findByTestId('T-02.result') },
  { id: 'T-06 refill', element: () => table('refill'), ready: () => screen.findByTestId('T-06.card') },
  { id: 'T-01 sitting out', element: () => table('sitting-out', undefined, sittingOutClient()), ready: () => screen.findByTestId('T-01.sitOut') },
  { id: 'T-01 alert', element: () => table('alert'), ready: () => screen.findByTestId('T-01.alert') },
  { id: 'X-01 not found', element: () => <AppShell><NotFoundScreen /></AppShell>, ready: () => screen.findByTestId('X-01.notFound') },
  { id: 'X-01 boot', element: () => <BootErrorScreen />, ready: () => screen.findByTestId('X-01.boot') },
];

export async function renderScreen(c: ScreenCase, lang: Lang): Promise<Harness> {
  const h = renderRoutes([{ path: '/s', element: c.element() }], '/s', { lang, ...(c.profile === null ? { profile: null } : {}) });
  await c.ready();
  return h;
}

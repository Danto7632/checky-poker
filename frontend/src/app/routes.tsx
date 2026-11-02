// Routes (routes.v1, R0 part). Every app path is a child of GateRoute; only X-01 (`*`) sits outside it. Paths whose
// screens do not exist yet (/host, /join, /help/connect, /arena, /history, /replay) are added by the stories that
// build them (2-3, 3-3, 4-3), under the same GateRoute.
//
// The practice screen is React.lazy and rendered by GateRoute's <Outlet/> only after the gate passed. Route-level
// `lazy`/`loader` are NOT used: a data router may run them at match time, i.e. before the gate (SS2 rule 3).
// Its loader is practice/warmup.ts loadPracticeScreen, which the shell warm-up also calls once the gate is passed, so
// "Practice" opens without a fetch whichever screen the tab entered on (R0-L12, R0-L29). X-01 runs the same warm-up
// when an earlier visit passed the gate (GatePassedWarmup: 404 -> offline -> home -> Practice, NB-1).
// createBrowserRouter (data router) stays because 2-3's host leave guard needs useBlocker.
import { lazy, Suspense } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppHome } from './home/AppHome';
import { loadPracticeScreen } from './practice/warmup';
import { SettingsScreen } from './settings/SettingsScreen';
import { AppShell } from './shell/AppShell';
import { BootErrorScreen } from './shell/BootErrorScreen';
import { GatePassedWarmup, GateRoute } from './shell/GateRoute';
import { NotFoundScreen } from './shell/NotFoundScreen';

const PracticeScreen = lazy(loadPracticeScreen);

export const routes: RouteObject[] = [
  {
    errorElement: <BootErrorScreen />,
    children: [
      {
        element: <GateRoute />,
        children: [
          { path: '/app', element: <AppShell><AppHome /></AppShell> },
          { path: '/practice', element: <Suspense fallback={null}><PracticeScreen /></Suspense> },
          { path: '/settings', element: <AppShell><SettingsScreen /></AppShell> },
        ],
      },
      {
        path: '*',
        element: (
          <>
            <AppShell><NotFoundScreen /></AppShell>
            <GatePassedWarmup />
          </>
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routes);

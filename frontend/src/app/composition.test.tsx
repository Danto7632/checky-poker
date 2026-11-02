// A-APP-COMPOSE (I-23): one storage instance; game services load lazily once (a failed load is retried); the practice
// client gets SessionDeps {hands, device, config} without a botDecider (D-A12) and the profile snapshot of the moment
// it was created — a rename in S-01 reaches the next client only (US2 AC3); leaving or unmounting disposes it exactly
// once, even when leave() rejects.
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeClient, PracticeOptions } from '@/session';
import { getAppServices, loadGameServices, resetGameServicesForTest, setAppServicesForTest } from './composition';
import PracticeScreen from './practice/PracticeScreen';
import { SettingsScreen } from './settings/SettingsScreen';
import { AppShell } from './shell/AppShell';
import { renderRoutes, servicesWith } from './testing/render';

const made = vi.hoisted(() => ({ opts: [] as unknown[], clients: [] as unknown[], sessionEvaluated: 0, failNext: false }));

vi.mock('@/session', async (importOriginal) => {
  made.sessionEvaluated += 1;
  const real = await importOriginal<typeof import('@/session')>();
  return {
    ...real,
    createPracticeClient: (opts: unknown) => {
      made.opts.push(opts);
      if (made.failNext) {
        made.failNext = false;
        throw Object.assign(new Error('E-WORKER-CRASH'), { code: 'E-WORKER-CRASH' });
      }
      const client = real.createFakeClient('practice-my-turn');
      made.clients.push(client);
      return client;
    },
  };
});
vi.mock('@/ai', () => ({ computeMetricsAsync: vi.fn(() => new Promise(() => undefined)), createMockDecider: vi.fn(), prewarmMetrics: vi.fn() }));

beforeEach(() => {
  made.opts.length = 0;
  made.clients.length = 0;
  resetGameServicesForTest();
});
afterEach(() => {
  cleanup();
  setAppServicesForTest(null);
});

const calls = (c: unknown, method: string) => (c as FakeClient).calls.filter((x) => x.method === method).length;
const routes = () => [
  { path: '/practice', element: <PracticeScreen /> },
  { path: '/app', element: <p>home screen</p> },
];

describe('composition', () => {
  it('creates the storage once', () => {
    const a = getAppServices();
    expect(getAppServices()).toBe(a);
    expect(getAppServices().storage).toBe(a.storage);
  });

  it('loads game services once (cached promise)', async () => {
    const { services } = servicesWith();
    const first = loadGameServices(services);
    expect(loadGameServices(services)).toBe(first);
    await first;
  });

  it('passes the profile snapshot and SessionDeps without botDecider', async () => {
    const h = renderRoutes(routes(), '/practice');
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    expect(made.opts).toHaveLength(1);
    const opts = made.opts[0] as PracticeOptions;
    expect(opts.profile).toMatchObject({ nickname: 'Mina', avatarSeed: 7, lang: 'en' });
    expect(opts.settings).toMatchObject({ turnSeconds: 60, sb: 50, bb: 100, startStack: 10000, liveEquity: true });
    expect(opts.bots.map((b) => b.label)).toEqual(['House 1', 'House 2', 'House 3']);
    expect(Object.keys(opts.deps).sort()).toEqual(['config', 'device', 'hands']);
    expect(opts.deps.hands).toBe(h.storage.hands);
    expect(opts.deps.device).toBe(h.storage.device);
    const settings = await h.storage.settings.get();
    expect(settings.liveEquityPractice).toBe(true);
    expect(settings.lastPracticeBots).toHaveLength(3);
  });

  it('US2 AC3 through S-01: a rename applies to the next table; the table already created keeps the old name', async () => {
    const h = renderRoutes(
      [...routes(), { path: '/settings', element: <AppShell><SettingsScreen /></AppShell> }],
      '/practice',
    );
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    await act(async () => {
      await h.router.navigate('/settings');
    });
    const input = await screen.findByDisplayValue('Mina');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    await act(async () => {
      fireEvent.blur(input);
    });
    expect(await screen.findByText('Saved')).toBeTruthy();
    await act(async () => {
      await h.router.navigate('/practice');
    });
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    expect(made.opts).toHaveLength(2);
    expect((made.opts[0] as PracticeOptions).profile.nickname).toBe('Mina');
    expect((made.opts[1] as PracticeOptions).profile.nickname).toBe('Renamed');
  });

  it('Leave (confirmed while in a hand) calls leave() then dispose() once and goes home', async () => {
    const h = renderRoutes(routes(), '/practice');
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    fireEvent.click(screen.getByTestId('T-01.leave'));
    const dialog = await screen.findByTestId('T-01.leaveDialog');
    expect(document.activeElement?.textContent).toBe('Stay'); // safe action focused first
    await act(async () => {
      fireEvent.click(dialog.querySelectorAll('button')[1]!);
    });
    await screen.findByText('home screen');
    expect(h.router.state.location.pathname).toBe('/app');
    expect(calls(made.clients[0], 'leave')).toBe(1);
    expect(calls(made.clients[0], 'dispose')).toBe(1);
  });

  it('Leave still disposes and goes home when leave() rejects, without an unhandled rejection (review m9)', async () => {
    const h = renderRoutes(routes(), '/practice');
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    const client = made.clients[0] as FakeClient;
    client.leave = () => Promise.reject(new Error('worker gone'));
    fireEvent.click(screen.getByTestId('T-01.leave'));
    const dialog = await screen.findByTestId('T-01.leaveDialog');
    await act(async () => {
      fireEvent.click(dialog.querySelectorAll('button')[1]!);
    });
    await screen.findByText('home screen');
    expect(h.router.state.location.pathname).toBe('/app');
    expect(calls(client, 'dispose')).toBe(1);
  });

  it('unmounting the practice screen disposes the client exactly once', async () => {
    const h = renderRoutes(routes(), '/practice');
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    h.unmount();
    expect(calls(made.clients[0], 'dispose')).toBe(1);
  });

  it('E-WORKER-CRASH on creation -> practice crash screen; "Start again" creates a new client with the same settings', async () => {
    made.failNext = true;
    renderRoutes(routes(), '/practice');
    fireEvent.click(await screen.findByTestId('PR-01.dealIn'));
    expect((await screen.findByTestId('PR-01.crash')).textContent).toContain('The practice table stopped unexpectedly');
    await act(async () => {
      fireEvent.click(screen.getByTestId('PR-01.crashRestart'));
    });
    await screen.findByTestId('T-01.felt');
    expect(made.opts).toHaveLength(2);
    expect((made.opts[1] as PracticeOptions).settings).toEqual((made.opts[0] as PracticeOptions).settings);
  });

  it('a failed game-services load is not cached: the next call retries the import (review m1)', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('./game-services', async (importOriginal) => {
      attempts += 1;
      // A transient fetch failure (connection dropped mid-request): the next import() is a new request (review O-2).
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return importOriginal<object>();
    });
    const fresh = await vi.importActual<typeof import('./composition')>('./composition');
    const { services } = servicesWith();
    await expect(fresh.loadGameServices(services)).rejects.toThrow(); // Vitest wraps the factory error
    const second = fresh.loadGameServices(services);
    await expect(second).resolves.toHaveProperty('createPractice');
    expect(attempts).toBe(2);
    expect(fresh.loadGameServices(services)).toBe(second); // a success stays cached
    vi.doUnmock('./game-services');
  });
});

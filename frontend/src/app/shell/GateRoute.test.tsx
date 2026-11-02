// GateRoute (A-APP-GATE, SS2, US1, US44, FS-GATE-1..6).
//
// "Module evaluation watch": vi.mock factories for @/session and @/ai flip a flag when the module is first
// evaluated. Every watch case starts from a fresh module graph (vi.resetModules + re-imports), so "nothing
// evaluated before the gate" is measured from zero. Two kinds of case:
// - the REAL route graph (routes.tsx with every screen it imports statically) at /app, /practice and /settings —
//   module evaluation happens at import time, not render time, so only the real graph catches a routed screen that
//   starts importing session or ai as a value (review M1);
// - dummy children for paths whose screens do not exist yet (/join, /replay, /arena), which load game services on
//   mount like the real game screens will.
// Release gate requirement: relay and LLM code is not even loaded before the notice is accepted (SS2 rule 3).
// The build-level twin of this check is scan-dist S8 (no Worker/WebSocket/RTCPeerConnection in the entry chunk).
import { createElement, type ReactElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
// The idb wrapper needs the IDB* globals (IDBKeyRange, ...) that fake-indexeddb/auto installs; each test still passes
// its own factory.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type StorageApi } from '@/storage';
import { createAppServices } from '../composition';
import { NOTICE_VERSION } from '../gate/notice';
import { createMemoryStorage } from '../testing/memory-storage';
import { PROFILE, renderRoutes } from '../testing/render';
import { captureBootDestination } from './boot';
import { GateRoute } from './GateRoute';
import { ServicesProvider } from './ServicesProvider';
import { TooltipProvider } from '../ui/Tooltip';

// R0-L23 (Jonnathan, w5-r0-design-changes-2): one neutral sentence, true whichever store failed.
const STORAGE_WARN =
  "This browser isn't letting Checky Poker save everything (private mode or storage turned off), so next time we may ask again and your hand history and settings may not be kept.";
const STORAGE_WARN_JA =
  'このブラウザでは一部のデータを保存できません（プライベートモードまたはストレージ無効）。次回もう一度お聞きしたり、ハンド履歴や設定が残らなかったりすることがあります。';

const watch = vi.hoisted(() => ({ session: false, ai: false, practice: false, adult: '' }));

vi.mock('@/session', async (importOriginal) => {
  watch.session = true;
  return importOriginal<object>();
});
vi.mock('@/ai', () => {
  watch.ai = true;
  return { computeMetricsAsync: vi.fn(() => new Promise(() => undefined)), createMockDecider: vi.fn(), prewarmMetrics: vi.fn() };
});
vi.mock('@/config', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/config')>();
  return {
    ...real,
    flags: {
      ...real.flags,
      get ADULT_CHECK() {
        return watch.adult;
      },
    },
  };
});

afterEach(() => {
  cleanup();
  watch.adult = '';
  sessionStorage.clear();
});

const child = (text: string): ReactElement => createElement('p', null, text);
const gateRoutes = () => [
  {
    element: <GateRoute />,
    children: [
      { path: '/app', element: child('home screen') },
      { path: '/practice', element: child('practice screen') },
      { path: '/join', element: child('join screen') },
    ],
  },
];

/**
 * A fresh module graph with the watching factories re-registered (vi.resetModules clears modules, not the mock
 * factory cache). Everything that could transitively import session/ai is re-imported from here; vi.importActual
 * (not import()) because lint allows dynamic import() of './x' only — nothing imported this way is itself mocked,
 * but its own imports still resolve through the mocks.
 */
async function freshGraph(opts: { consented?: boolean } = {}) {
  vi.resetModules();
  watch.session = false;
  watch.ai = false;
  watch.practice = false;
  // The /practice route chunk (React.lazy and the H-01 preload share practice/warmup.ts loadPracticeScreen).
  vi.doMock('../practice/PracticeScreen', async (importOriginal) => {
    watch.practice = true;
    return importOriginal<object>();
  });
  vi.doMock('@/session', async (importOriginal) => {
    watch.session = true;
    const real = await importOriginal<typeof import('@/session')>();
    // The real practice client starts a Worker; a fake table is enough to prove the module was reached.
    return { ...real, createPracticeClient: () => real.createFakeClient('practice-my-turn') };
  });
  vi.doMock('@/ai', () => {
    watch.ai = true;
    return { computeMetricsAsync: vi.fn(() => new Promise(() => undefined)), createMockDecider: vi.fn(), prewarmMetrics: vi.fn() };
  });
  const rtl = await vi.importActual<typeof import('@testing-library/react')>('@testing-library/react');
  const React = await vi.importActual<typeof import('react')>('react');
  const router = await vi.importActual<typeof import('react-router')>('react-router');
  const { ServicesProvider } = await import('./ServicesProvider');
  const composition = await vi.importActual<typeof import('../composition')>('../composition');
  const memory = await vi.importActual<typeof import('../testing/memory-storage')>('../testing/memory-storage');
  const { TooltipProvider } = await vi.importActual<typeof import('../ui/Tooltip')>('../ui/Tooltip');
  const services = composition.createAppServices(memory.createMemoryStorage({ profile: PROFILE, consentVersion: opts.consented ? NOTICE_VERSION : null, lang: 'en' }));
  const render = (routes: Parameters<typeof router.createMemoryRouter>[0], path: string) =>
    rtl.render(
      React.createElement(ServicesProvider, {
        services,
        children: React.createElement(TooltipProvider, {
          children: React.createElement(router.RouterProvider, { router: router.createMemoryRouter(routes, { initialEntries: [path] }) }),
        }),
      }),
    );
  return { rtl, React, composition, services, render };
}

describe('module evaluation watch (session/ai only after the gate)', () => {
  beforeEach(() => {
    watch.session = false;
    watch.ai = false;
  });

  it.each(['/app', '/practice', '/settings'])('real routes.tsx %s: nothing evaluated before the notice', async (path) => {
    const g = await freshGraph();
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, path);
    expect(g.rtl.screen.getByText('Before you play')).toBeTruthy();
    expect(watch.session).toBe(false);
    expect(watch.ai).toBe(false);
    expect(watch.practice).toBe(false);
    g.rtl.cleanup();
  });

  it('real routes.tsx /app: the shell warm-up at H-01 loads the practice chunk, session and ai once the gate is passed — before Practice is pressed (F-1)', async () => {
    const g = await freshGraph();
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/app');
    expect(watch.practice || watch.session || watch.ai).toBe(false);
    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('G-01.ctaAdult'));
    const practice = await g.rtl.screen.findByTestId('H-01.practice');
    // H-01's Practice card says "works offline": the shell warm-up fetches what Practice -> "Deal me in" needs online.
    await g.rtl.waitFor(() => expect({ practice: watch.practice, session: watch.session, ai: watch.ai }).toEqual({ practice: true, session: true, ai: true }));
    g.rtl.fireEvent.click(practice);
    g.rtl.fireEvent.click(await g.rtl.screen.findByTestId('PR-01.dealIn'));
    await g.rtl.screen.findByTestId('T-01.felt');
    g.rtl.cleanup();
  });

  it('real routes.tsx /app offline at H-01: the practice chunk preload fails silently and Practice imports it again (F-1)', async () => {
    const g = await freshGraph();
    let attempts = 0;
    vi.doMock('../practice/PracticeScreen', async (importOriginal) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      watch.practice = true;
      return importOriginal<object>();
    });
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/app');
    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('G-01.ctaAdult'));
    const practice = await g.rtl.screen.findByTestId('H-01.practice');
    await g.rtl.waitFor(() => expect(attempts).toBe(1));
    await new Promise((r) => setTimeout(r, 0)); // the rejection settles here: it must not surface as unhandled
    expect(watch.practice).toBe(false);
    g.rtl.fireEvent.click(practice); // back online: React.lazy runs the same loader again
    expect(await g.rtl.screen.findByTestId('PR-01.dealIn')).toBeTruthy();
    expect(attempts).toBe(2);
    g.rtl.cleanup();
  });

  // Each case ends on PR-01 through the app (home -> Practice): that also waits for the chunk import to settle, so the
  // next fresh graph never inherits an import still in flight.
  it('real routes.tsx /settings: the shell warm-up after the gate loads the practice chunk, session and ai on S-01 too (NB-1, R0-L29)', async () => {
    const g = await freshGraph();
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/settings');
    expect(watch.practice || watch.session || watch.ai).toBe(false);
    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('G-01.ctaAdult'));
    await g.rtl.screen.findByTestId('S-01.nickname');
    await g.rtl.waitFor(() => expect({ practice: watch.practice, session: watch.session, ai: watch.ai }).toEqual({ practice: true, session: true, ai: true }));
    g.rtl.fireEvent.click(g.rtl.screen.getByRole('link', { name: 'Checky Poker' })); // TopBar home link
    g.rtl.fireEvent.click(await g.rtl.screen.findByTestId('H-01.practice'));
    expect(await g.rtl.screen.findByTestId('PR-01.dealIn')).toBeTruthy();
    g.rtl.cleanup();
  });

  it('real routes.tsx X-01 (`*`, outside the gate): nothing evaluated for a visitor without consent', async () => {
    const g = await freshGraph();
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/no-such-page');
    await g.rtl.screen.findByTestId('X-01.notFound');
    await new Promise((r) => setTimeout(r, 20));
    expect({ practice: watch.practice, session: watch.session, ai: watch.ai }).toEqual({ practice: false, session: false, ai: false });
    g.rtl.cleanup();
  });

  it('real routes.tsx X-01 after an earlier visit passed the gate: the shell warm-up runs there (404 -> offline -> home, NB-1)', async () => {
    const g = await freshGraph({ consented: true });
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/no-such-page');
    await g.rtl.screen.findByTestId('X-01.notFound');
    await g.rtl.waitFor(() => expect({ practice: watch.practice, session: watch.session, ai: watch.ai }).toEqual({ practice: true, session: true, ai: true }));
    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('X-01.home'));
    g.rtl.fireEvent.click(await g.rtl.screen.findByTestId('H-01.practice'));
    expect(await g.rtl.screen.findByTestId('PR-01.dealIn')).toBeTruthy();
    g.rtl.cleanup();
  });

  it('real routes.tsx X-01 with an adult step pending for this language: nothing evaluated (the step is GateRoute tab memory)', async () => {
    watch.adult = 'en';
    const g = await freshGraph({ consented: true });
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/no-such-page');
    await g.rtl.screen.findByTestId('X-01.notFound');
    await new Promise((r) => setTimeout(r, 20));
    expect({ practice: watch.practice, session: watch.session, ai: watch.ai }).toEqual({ practice: false, session: false, ai: false });
    g.rtl.cleanup();
  });

  it('real routes.tsx /practice: session and ai stay unevaluated through the notice, and load once PR-01 is up', async () => {
    const g = await freshGraph();
    const { routes } = await vi.importActual<typeof import('../routes')>('../routes');
    g.render(routes, '/practice');
    expect(watch.session).toBe(false);
    expect(watch.ai).toBe(false);
    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('G-01.ctaAdult'));
    const dealIn = await g.rtl.screen.findByTestId('PR-01.dealIn');
    // The shell warm-up (R0-L12, R0-L29) loads the game modules while the page is online — after the gate, never before.
    await g.rtl.waitFor(() => expect(watch.session && watch.ai).toBe(true));
    g.rtl.fireEvent.click(dealIn);
    await g.rtl.screen.findByTestId('T-01.felt');
    g.rtl.cleanup();
  });

  it.each(['/join', '/replay', '/arena'])('dummy child %s: nothing evaluated before the gate, both after', async (path) => {
    const g = await freshGraph();
    function GameChild() {
      const [state, setState] = g.React.useState('loading');
      g.React.useEffect(() => {
        void g.composition.loadGameServices(g.services).then(() => setState('loaded'));
      }, []);
      return g.React.createElement('p', null, `${path} ${state}`);
    }
    const { GateRoute: FreshGate } = await import('./GateRoute');
    g.render([{ element: g.React.createElement(FreshGate), children: [{ path, element: g.React.createElement(GameChild) }] }], path);

    expect(g.rtl.screen.getByText('Before you play')).toBeTruthy();
    expect(watch.session).toBe(false);
    expect(watch.ai).toBe(false);

    g.rtl.fireEvent.click(g.rtl.screen.getByTestId('G-01.ctaAdult'));
    await g.rtl.screen.findByText(`${path} loaded`);
    expect(watch.session).toBe(true);
    expect(watch.ai).toBe(true);
    g.rtl.cleanup();
  });
});

describe('G-01 notice', () => {
  it('shows before any game screen when there is no consent, then passes without redirect (FS-GATE-6)', async () => {
    const h = renderRoutes(gateRoutes(), '/practice', { consented: false });
    expect(screen.getByText('Before you play')).toBeTruthy();
    expect(screen.queryByText('practice screen')).toBeNull();
    expect(screen.getByTestId('G-01.destination').textContent).toBe("You're starting a practice game");
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('practice screen');
    expect(h.router.state.location.pathname).toBe('/practice');
    expect(h.storage.consent.get()?.version).toBe(NOTICE_VERSION);
  });

  it.each([
    ['en', ['For adults 18 and over.', "Chips are play money. They have no cash value and can't be bought, sold, exchanged or given to anyone.", 'Never bet real money on a game here.', "This is not gambling. It's a free game to play with friends."]],
    ['ja', ['18歳以上の方が対象です。', 'チップは遊び用です。現金としての価値はなく、購入・販売・換金・譲渡はできません。', 'ここでのゲームに実際のお金を賭けないでください。', 'これはギャンブルではありません。友達と遊ぶための無料ゲームです。']],
  ] as const)('lists all four statements in %s (US1 AC4)', (lang, items) => {
    renderRoutes(gateRoutes(), '/app', { consented: false, lang });
    for (const text of items) expect(screen.getByText(text)).toBeTruthy();
  });

  it('focuses the title, not a button (no accidental Enter)', () => {
    renderRoutes(gateRoutes(), '/app', { consented: false });
    expect(document.activeElement?.textContent).toBe('Before you play');
  });

  it('shows the notice again after NOTICE_VERSION goes up (version bump, US1 AC3)', () => {
    const storage = createMemoryStorage({ profile: PROFILE, consentVersion: NOTICE_VERSION - 1, lang: 'en' });
    renderRoutes(gateRoutes(), '/app', { storage, services: createAppServices(storage) });
    expect(screen.getByText('Before you play')).toBeTruthy();
  });

  it('skips the notice when the stored version is current', async () => {
    renderRoutes(gateRoutes(), '/app');
    expect(await screen.findByText('home screen')).toBeTruthy();
    expect(screen.queryByText('Before you play')).toBeNull();
  });

  it('passes for this tab and warns when consent cannot be saved (gate.storageWarn)', async () => {
    const storage = createMemoryStorage({ profile: PROFILE, consentVersion: null, lang: 'en' });
    storage.consent.accept = () => {
      throw new Error('storage blocked');
    };
    renderRoutes(gateRoutes(), '/app', { storage, services: createAppServices(storage) });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
    expect(screen.getByText(STORAGE_WARN)).toBeTruthy();
  });
});

describe('G-01 with storage unavailable (E-STO-UNAVAILABLE)', () => {
  it('passes and shows gate.storageWarn when storage reports the issue', async () => {
    const storage = createMemoryStorage({ profile: PROFILE, consentVersion: null, lang: 'en' });
    storage.setIssue('E-STO-UNAVAILABLE');
    renderRoutes(gateRoutes(), '/app', { storage, services: createAppServices(storage) });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
    expect(screen.getByText(STORAGE_WARN)).toBeTruthy();
  });
});

describe('G-01 with the real storage: localStorage refuses the consent write (R0-L2, review m4)', () => {
  /** A localStorage that reads fine and refuses every write (quota, some privacy modes). */
  function refusingLocalStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      key: (i) => [...data.keys()][i] ?? null,
      getItem: (k) => data.get(k) ?? null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      clear: () => data.clear(),
    };
  }

  /** renderRoutes takes the in-memory double; this case needs the real StorageApi. */
  const renderGate = (storage: StorageApi) =>
    render(
      <ServicesProvider services={createAppServices(storage)}>
        <TooltipProvider>
          <RouterProvider router={createMemoryRouter(gateRoutes(), { initialEntries: ['/app'] })} />
        </TooltipProvider>
      </ServicesProvider>,
    );

  it('IndexedDB works, localStorage refuses: G-01 passes for this tab with gate.storageWarn, and asks again next visit', async () => {
    const localStorage = refusingLocalStorage();
    const indexedDB = new IDBFactory();
    const storage = createStorage({ indexedDB, localStorage });
    await storage.profile.save({ nickname: 'Mina', avatarSeed: 7, lang: 'en' });
    expect(storage.issue()).toBeNull(); // IndexedDB is fine: nothing to report before the notice
    renderGate(storage);
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
    expect(screen.getByText(STORAGE_WARN)).toBeTruthy();
    // The memory fallback makes the read-back look saved; the warning comes from the issue channel alone.
    expect(storage.consent.get()?.version).toBe(NOTICE_VERSION);
    expect(storage.issue()).toBe('E-STO-UNAVAILABLE');
    // Next visit (new page, same browser storage): nothing was stored, so the notice shows again.
    cleanup();
    renderGate(createStorage({ indexedDB, localStorage }));
    expect(screen.getByText('Before you play')).toBeTruthy();
  });

  // Re-review O-1 / R0-L23: the other cause behind the same E-STO-UNAVAILABLE. Consent IS saved here, so the old copy
  // ("we'll ask again next time") was false; the new one says "may" and names what is really lost (history, settings).
  it('IndexedDB unavailable, localStorage fine: the same warning, true here too — the next visit does not ask again', async () => {
    const localStorage = window.localStorage;
    localStorage.clear();
    const storage = createStorage({ indexedDB: undefined, localStorage });
    await storage.profile.save({ nickname: 'Mina', avatarSeed: 7, lang: 'en' });
    renderGate(storage);
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText(STORAGE_WARN);
    cleanup();
    renderGate(createStorage({ indexedDB: undefined, localStorage }));
    // Consent was kept; the nickname (IndexedDB) was not, so P-01 asks for it — the "may not be kept" half.
    expect(await screen.findByTestId('P-01.card')).toBeTruthy();
    expect(screen.queryByText('Before you play')).toBeNull();
    localStorage.clear();
  });
});

describe('G-01 storage warning in Japanese (R0-L23)', () => {
  it('shows the ja sentence', async () => {
    const storage = createMemoryStorage({ profile: { ...PROFILE, lang: 'ja' }, consentVersion: null, lang: 'ja' });
    storage.setIssue('E-STO-UNAVAILABLE');
    renderRoutes(gateRoutes(), '/app', { storage, services: createAppServices(storage), lang: 'ja' });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
    expect(screen.getByText(STORAGE_WARN_JA)).toBeTruthy();
  });
});

describe('G-02 underage', () => {
  it('blocks without saving anything and shows G-01 again after a reload (US1 AC2)', () => {
    const h = renderRoutes(gateRoutes(), '/app', { consented: false });
    const accept = vi.spyOn(h.storage.consent, 'accept');
    fireEvent.click(screen.getByTestId('G-01.ctaMinor'));
    expect(screen.getByText('Checky Poker is for adults')).toBeTruthy();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(accept).not.toHaveBeenCalled();
    expect(h.storage.consent.get()).toBeNull();
    // "Reload": a new page with the same storage starts at G-01.
    cleanup();
    renderRoutes(gateRoutes(), '/app', { storage: h.storage, services: h.services });
    expect(screen.getByText('Before you play')).toBeTruthy();
  });
});

describe('G-03 adult step (VITE_ADULT_CHECK)', () => {
  it('adds one step when the UI language is listed (US44 AC2)', async () => {
    watch.adult = 'en';
    renderRoutes(gateRoutes(), '/app', { consented: false });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    expect(await screen.findByText('One more step')).toBeTruthy();
    fireEvent.click(screen.getByTestId('G-03.continue'));
    await screen.findByText('home screen');
  });

  it('renders nothing extra with the default empty flag (US44 AC3)', async () => {
    watch.adult = '';
    renderRoutes(gateRoutes(), '/app', { consented: false });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
    expect(screen.queryByText('One more step')).toBeNull();
  });

  it('does not trigger for an unlisted language', async () => {
    watch.adult = 'ko';
    renderRoutes(gateRoutes(), '/app', { consented: false });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await screen.findByText('home screen');
  });
});

describe('P-01 after consent', () => {
  it('asks for a nickname when there is no profile, then shows the destination', async () => {
    renderRoutes(gateRoutes(), '/app', { consented: false, profile: null });
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    const input = await screen.findByLabelText('Nickname');
    fireEvent.change(input, { target: { value: 'Ken' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('P-01.continue'));
    });
    await screen.findByText('home screen');
  });
});

describe('invite link boot (US1 AC5, R0 part)', () => {
  it('keeps /join and the invite in cp.boot.v1 through the gate', async () => {
    window.history.replaceState(null, '', '/join#K7Q2MA9XPB');
    expect(captureBootDestination()).toEqual({ route: '/join', secret: 'K7Q2MA9XPB' });
    expect(window.location.hash).toBe('');
    const h = renderRoutes(gateRoutes(), '/join', { consented: false });
    const memory = h.router;
    expect(screen.getByTestId('G-01.destination').textContent).toBe("You're joining a friend's room");
    fireEvent.click(screen.getByTestId('G-01.ctaAdult'));
    await waitFor(() => expect(screen.getByText('join screen')).toBeTruthy());
    expect(memory.state.location.pathname).toBe('/join');
    expect(JSON.parse(sessionStorage.getItem('cp.boot.v1') ?? 'null')).toEqual({ route: '/join', secret: 'K7Q2MA9XPB' });
  });
});

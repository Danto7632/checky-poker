// Practice warm-up (R0-L12 app side, R0-L13, fix2 review F-1; lead review 3 R0-L27, R0-L29).
// 1. Once the gate is passed, the app shell warms the practice flow — whatever screen the tab entered on (H-01, PR-01,
//    S-01, or X-01 for a tab that passed the gate before): game services, both Workers (prewarmPracticeHost,
//    prewarmMetrics) and the font loader for every family stack, before any table exists. Steps 0-2 run once per tab.
//    The `practice_flow.preloaded` list that scan-dist S9 checks the built dist against is tied to these calls: each
//    listed chunk has a trigger asserted here, so neither the list nor the warm-up can change alone. That the shell
//    loads the PracticeScreen chunk itself (from a fresh module graph, per entry screen) is asserted on the real route
//    graph in GateRoute.test.tsx; here the chunk is evaluated once per file.
// 2. PR-01 draws "Works offline once this page has loaded" only once the warm-up has settled without an error and both
//    Workers have answered (prewarm promises true, R0-L36).
// 3. Glyph coverage, en and ja: every character the practice-flow screens can render — the dictionary keys those
//    sources use (literal and built `prefix.${x}` keys), the non-ASCII glyphs the code writes itself, Intl number
//    output, the lead review's symbols and the names on the table — is in the warm-up text. A glyph left out is a
//    font subset fetched for the first time offline (MS-R0-3 D2: "→" in the result, "½ ¾" in BetSizer).
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lang } from '@checky/engine/protocol';
import scanAllow from '../../../scripts/scan-allow.json';
import { resetGameServicesForTest } from '../composition';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { routes } from '../routes';
import { formatChips, formatDelta, formatPercent1, formatPotOdds } from '../table/format';
import { renderRoutes, servicesWith } from '../testing/render';
import { CODE_GLYPHS, practiceGlyphs, resetPracticeWarmupForTest } from './warmup';

const calls = vi.hoisted(() => ({ host: 0, metrics: 0, clients: 0, gameServices: 0, practiceChunk: 0 }));
/** What each Worker's prewarm promise resolves to (R0-L36: true = it answered); a test may hand out pending ones. */
const ready = vi.hoisted(() => ({ host: () => Promise.resolve(true), metrics: () => Promise.resolve(true) }));

vi.mock('@/session', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/session')>();
  return {
    ...real,
    prewarmPracticeHost: () => {
      calls.host += 1;
      return ready.host();
    },
    createPracticeClient: () => {
      calls.clients += 1;
      return real.createFakeClient('practice-my-turn');
    },
  };
});
vi.mock('@/ai', () => ({
  computeMetricsAsync: vi.fn(() => new Promise(() => undefined)),
  createMockDecider: vi.fn(),
  prewarmMetrics: () => {
    calls.metrics += 1;
    return ready.metrics();
  },
}));
vi.mock('../game-services', async (importOriginal) => {
  calls.gameServices += 1;
  return importOriginal<object>();
});
vi.mock('./PracticeScreen', async (importOriginal) => {
  calls.practiceChunk += 1;
  return importOriginal<object>();
});

const FAMILIES = { '--font-ui': '"Pretendard JP Variable", sans-serif', '--font-display': '"Bricolage Grotesque Variable", "Pretendard JP Variable"', '--font-mono': '"JetBrains Mono Variable", monospace' };
let load: ReturnType<typeof vi.fn<(font: string, text: string) => Promise<FontFace[]>>>;

beforeEach(() => {
  Object.assign(calls, { host: 0, metrics: 0, clients: 0 });
  Object.assign(ready, { host: () => Promise.resolve(true), metrics: () => Promise.resolve(true) });
  resetGameServicesForTest();
  resetPracticeWarmupForTest();
  load = vi.fn(() => Promise.resolve([]));
  // happy-dom has no FontFaceSet; tokens.css is not loaded in unit tests, so the three token stacks are set inline.
  Object.defineProperty(document, 'fonts', { value: { load }, configurable: true });
  for (const [token, family] of Object.entries(FAMILIES)) document.documentElement.style.setProperty(token, family);
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'fonts');
  for (const token of Object.keys(FAMILIES)) document.documentElement.style.removeProperty(token);
});

/** What makes each S9-listed chunk loaded once the shell warm-up ran (scan-allow.json practice_flow.preloaded). */
const TRIGGERS: Record<string, () => boolean> = {
  PracticeScreen: () => calls.practiceChunk > 0,
  'game-services': () => calls.gameServices > 0,
  worker: () => calls.host > 0,
  'metrics.worker': () => calls.metrics > 0,
};
const familyLoads = () => Object.values(FAMILIES).map((f) => `16px ${f}`).sort();
const OFFLINE = 'Works offline once this page has loaded.';
/** The PR-01 sentence is drawn when its line is not `invisible` (it keeps its place either way). */
const offlineDrawn = () => !screen.getByTestId('PR-01.offline').classList.contains('invisible');

describe('shell warm-up once the gate is passed (R0-L12, R0-L29)', () => {
  it('the S9 preload list and the warm-up name the same chunks', () => {
    expect(scanAllow.practice_flow.preloaded.map((e) => e.chunk).sort()).toEqual(Object.keys(TRIGGERS).sort());
  });

  it.each([
    ['/app', 'H-01.practice'],
    ['/practice', 'PR-01.card'],
    ['/settings', 'S-01.nickname'],
    ['/no-such-page', 'X-01.notFound'],
  ])('entering on %s: game services, both Workers and the fonts of all three stacks are warmed — no table yet', async (path, testId) => {
    renderRoutes(routes, path);
    await screen.findByTestId(testId);
    await waitFor(() => expect(calls.host).toBe(1));
    expect(calls.metrics).toBe(1);
    await waitFor(() => expect(TRIGGERS.PracticeScreen!()).toBe(true));
    for (const [chunk, fired] of Object.entries(TRIGGERS)) expect([chunk, fired()]).toEqual([chunk, true]);
    expect(calls.clients).toBe(0);
    await waitFor(() => expect(load.mock.calls.at(-1)?.[1]).toBe(practiceGlyphs('en', ['Mina'])));
    expect(load.mock.calls.slice(-3).map(([font]) => font).sort()).toEqual(familyLoads());
    const text = load.mock.calls.at(-1)![1];
    for (const ch of '→½¾≈±−·—Mina0123456789') expect(text).toContain(ch);
  });

  it('X-01 for a visitor who has not accepted the notice warms nothing (SS2 rule 3)', async () => {
    renderRoutes(routes, '/no-such-page', { consented: false });
    await screen.findByTestId('X-01.notFound');
    await new Promise((r) => setTimeout(r, 20));
    expect({ host: calls.host, metrics: calls.metrics, fonts: load.mock.calls.length }).toEqual({ host: 0, metrics: 0, fonts: 0 });
  });

  it('once per tab: S-01 -> H-01 -> Practice -> H-01 -> Practice -> X-01 -> home -> "Deal me in" warms Workers and services once', async () => {
    const h = renderRoutes(routes, '/settings');
    await screen.findByTestId('S-01.nickname');
    await waitFor(() => expect(calls.host).toBe(1));
    const go = async (path: string, testId: string) => {
      await act(async () => {
        await h.router.navigate(path);
      });
      await screen.findByTestId(testId);
    };
    await go('/app', 'H-01.practice');
    await go('/practice', 'PR-01.dealIn');
    await go('/app', 'H-01.practice');
    await go('/practice', 'PR-01.dealIn');
    await go('/no-such-page', 'X-01.notFound'); // outside the gate: the shell warm-up unmounts and mounts again
    await go('/practice', 'PR-01.dealIn');
    await waitFor(() => expect(offlineDrawn()).toBe(true));
    expect({ host: calls.host, metrics: calls.metrics }).toEqual({ host: 1, metrics: 1 });
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    await screen.findByTestId('T-01.felt');
    expect({ host: calls.host, metrics: calls.metrics, clients: calls.clients }).toEqual({ host: 1, metrics: 1, clients: 1 });
  });

  it('a language switched online warms the new language\'s glyphs; services and Workers are not warmed again', async () => {
    renderRoutes(routes, '/app');
    await screen.findByTestId('H-01.practice');
    await waitFor(() => expect(load.mock.calls.at(-1)?.[1]).toBe(practiceGlyphs('en', ['Mina'])));
    // Offline, a switch falls back to other fonts (warmup.ts ponytail, N-1 — current language only).
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ja' } });
    await waitFor(() => expect(load.mock.calls.at(-1)?.[1]).toBe(practiceGlyphs('ja', ['Mina'])));
    expect(load.mock.calls.slice(-3).map(([font]) => font).sort()).toEqual(familyLoads());
    expect({ host: calls.host, metrics: calls.metrics }).toEqual({ host: 1, metrics: 1 });
  });

  it('a game-services chunk that fails to load is forgotten: the next warm-up imports again', async () => {
    vi.resetModules();
    let attempts = 0;
    vi.doMock('../game-services', async (importOriginal) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return importOriginal<object>();
    });
    const fresh = await vi.importActual<typeof import('./warmup')>('./warmup');
    const { services } = servicesWith();
    await expect(fresh.warmPracticeTab(services)).rejects.toThrow(); // vitest wraps the factory's TypeError
    expect(calls.host).toBe(0);
    await fresh.warmPracticeTab(services);
    expect({ attempts, host: calls.host, metrics: calls.metrics }).toEqual({ attempts: 2, host: 1, metrics: 1 });
    vi.doUnmock('../game-services');
  });
});

describe('PR-01 draws its offline sentence only after the warm-up (R0-L27, MS-R0-3 run 2 D-R2-1; R0-L36)', () => {
  it('not while the warm-up runs; drawn once it settles — and "Deal me in" works throughout', async () => {
    const pending: (() => void)[] = [];
    load.mockImplementation(() => new Promise((resolve) => pending.push(() => resolve([]))));
    renderRoutes(routes, '/practice');
    expect(await screen.findByText(OFFLINE)).toBeTruthy(); // its line is laid out (no shift when it appears) …
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    expect(offlineDrawn()).toBe(false); // … but not drawn yet
    expect((screen.getByTestId('PR-01.dealIn') as HTMLButtonElement).disabled).toBe(false);
    await act(async () => pending.forEach((settle) => settle()));
    await waitFor(() => expect(offlineDrawn()).toBe(true));
  });

  it('a warm-up that fails never draws it; PR-01 stays usable and nothing is left unhandled', async () => {
    load.mockImplementation(() => Promise.reject(new DOMException('A network error occurred.', 'NetworkError')));
    renderRoutes(routes, '/practice');
    await screen.findByTestId('PR-01.dealIn');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20)); // every rejection has settled here
    expect(offlineDrawn()).toBe(false);
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    expect(await screen.findByTestId('T-01.felt')).toBeTruthy();
  });

  // R0-L36 (fix3 review R0-L27 residue): with 400 ms RTT the sentence was drawn before the Worker scripts arrived.
  // Fonts and imports are done in each case below, so only the Workers' answers decide.
  it.each(['host', 'metrics'] as const)('not while the %s Worker has not answered; drawn once it answers true', async (which) => {
    let answer!: (up: boolean) => void;
    const answered = new Promise<boolean>((resolve) => (answer = resolve));
    ready[which] = () => answered;
    renderRoutes(routes, '/practice');
    await screen.findByTestId('PR-01.dealIn');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20)); // everything but that Worker has settled here
    expect(offlineDrawn()).toBe(false);
    await act(async () => answer(true));
    await waitFor(() => expect(offlineDrawn()).toBe(true));
  });

  it.each(['host', 'metrics'] as const)('never drawn when the %s Worker did not come up (false); PR-01 stays usable', async (which) => {
    ready[which] = () => Promise.resolve(false);
    renderRoutes(routes, '/practice');
    await screen.findByTestId('PR-01.dealIn');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20)); // every promise has settled here
    expect({ host: calls.host, metrics: calls.metrics, drawn: offlineDrawn() }).toEqual({ host: 1, metrics: 1, drawn: false });
    fireEvent.click(screen.getByTestId('PR-01.dealIn'));
    expect(await screen.findByTestId('T-01.felt')).toBeTruthy();
  });

  it('a false is forgotten like a failed import: the next warm-up (a language switch) asks again and draws on true', async () => {
    ready.host = () => Promise.resolve(false);
    const h = renderRoutes(routes, '/app');
    await screen.findByTestId('H-01.practice');
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20));
    ready.host = () => Promise.resolve(true); // e.g. the crashed Worker's replacement answers
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ja' } });
    await act(async () => {
      await h.router.navigate('/practice');
    });
    await waitFor(() => expect(offlineDrawn()).toBe(true));
    expect({ host: calls.host, metrics: calls.metrics }).toEqual({ host: 2, metrics: 2 });
  });

  it('a language switch reads "not ready" until the new fonts settle', async () => {
    const pendingJa: (() => void)[] = [];
    load.mockImplementation((_font, text) => (text.includes('あ') ? new Promise((resolve) => pendingJa.push(() => resolve([]))) : Promise.resolve([])));
    const h = renderRoutes(routes, '/app');
    await screen.findByTestId('H-01.practice');
    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ja' } });
    await act(async () => {
      await h.router.navigate('/practice');
    });
    await screen.findByTestId('PR-01.offline');
    expect(offlineDrawn()).toBe(false);
    await act(async () => pendingJa.forEach((settle) => settle()));
    await waitFor(() => expect(offlineDrawn()).toBe(true));
  });

  // fix3 review O-10 (mutation K19): a status belongs to the language AND the nickname it was reached with, as my
  // name is drawn on the table and its glyphs may need subsets the dictionary does not.
  it('a nickname change reads "not ready" until the fonts for the new name settle', async () => {
    const pendingName: (() => void)[] = [];
    load.mockImplementation((_font, text) => (text.includes('Ż') ? new Promise((resolve) => pendingName.push(() => resolve([]))) : Promise.resolve([])));
    const h = renderRoutes(routes, '/practice');
    await waitFor(() => expect(offlineDrawn()).toBe(true));
    const go = async (path: string) => {
      await act(async () => {
        await h.router.navigate(path);
      });
    };
    await go('/settings');
    const field = await screen.findByTestId('S-01.nickname');
    fireEvent.change(field, { target: { value: 'Żaneta' } });
    fireEvent.blur(field);
    await waitFor(() => expect(load.mock.calls.at(-1)?.[1]).toBe(practiceGlyphs('en', ['Żaneta'])));
    await go('/practice');
    await screen.findByTestId('PR-01.offline');
    expect(offlineDrawn()).toBe(false);
    await act(async () => pendingName.forEach((settle) => settle()));
    await waitFor(() => expect(offlineDrawn()).toBe(true));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// R0-L13 glyph coverage
// ---------------------------------------------------------------------------------------------------------------
// The practice flow: PR-01 + table (practice/, table/, cards/, bots/, ui/, brand/) and H-01 after Leave (home/,
// shell/ top bar and app shell).
const sources = import.meta.glob(
  ['../practice/**/*.{ts,tsx}', '../table/**/*.{ts,tsx}', '../cards/**/*.{ts,tsx}', '../bots/**/*.{ts,tsx}', '../ui/**/*.{ts,tsx}', '../brand/**/*.{ts,tsx}', '../home/**/*.{ts,tsx}', '../shell/{AppShell,TopBar,LanguageSwitch}.tsx', '!../**/*.test.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>;
const code = Object.fromEntries(Object.entries(sources).map(([f, src]) => [f, src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')]));
const KEYS = Object.keys(en);

/** Message keys a source can render: quoted literals that are keys, plus every key under a built `prefix.${x}`. */
function keysUsed(): string[] {
  const used = new Set<string>();
  for (const src of Object.values(code)) {
    for (const m of src.matchAll(/['"`]([a-zA-Z]+(?:\.[\w-]+)+)['"`]/g)) if (KEYS.includes(m[1]!)) used.add(m[1]!);
    for (const m of src.matchAll(/`([a-zA-Z]+(?:\.[\w-]+)*\.)\$\{/g)) for (const k of KEYS) if (k.startsWith(m[1]!)) used.add(k);
  }
  return [...used];
}

/** Non-ASCII glyphs the code writes itself (string literals and \uXXXX escapes), comments excluded. */
function codeGlyphs(): string[] {
  const out = new Set<string>();
  for (const src of Object.values(code)) {
    for (const ch of src) if (ch.charCodeAt(0) > 0x7e) out.add(ch);
    for (const m of src.matchAll(/\\u([0-9A-Fa-f]{4})/g)) out.add(String.fromCharCode(Number.parseInt(m[1]!, 16)));
  }
  return [...out];
}

describe.each([
  ['en', en],
  ['ja', ja],
] as const)('font warm-up covers every glyph of the practice flow (%s, R0-L13)', (lang: Lang, dict: Record<string, string>) => {
  const text = new Set(practiceGlyphs(lang, ['Mina', 'ミナ']));
  const missing = (s: string) => [...s].filter((ch) => !text.has(ch));

  it('scans the flow sources and finds the table keys', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    const used = keysUsed();
    for (const k of ['refill.done', 'table.sr.turn', 'sizer.halfPot', 'act.timeout.fold', 'result.wins', 'menu.pause', 'home.greeting']) {
      if (KEYS.includes(k)) expect(used).toContain(k);
    }
    expect(used.some((k) => k.startsWith('rank.'))).toBe(true);
  });

  it('every key those sources use (placeholders aside)', () => {
    const gaps = keysUsed().flatMap((k) => missing((dict[k] ?? '').replace(/\{\w+\}/g, '')).map((ch) => `${k}: ${ch}`));
    expect(gaps).toEqual([]);
  });

  it('glyphs written by code, the lead review symbols, Intl output and the names on the table', () => {
    expect(codeGlyphs().filter((ch) => !text.has(ch))).toEqual([]);
    expect(missing(`${CODE_GLYPHS}→½¾≈±−·—`)).toEqual([]);
    const numbers = [formatChips(1234567, lang), formatChips(12500, lang, true), formatDelta(-2400, lang), formatDelta(2400, lang), formatPercent1(0.241, lang), formatPotOdds(6000, 2400, lang)];
    expect(numbers.flatMap(missing)).toEqual([]);
    expect(missing('Mina ミナ House 5')).toEqual([]);
  });
});

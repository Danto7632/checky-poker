// Practice warm-up (lead review 2 R0-L12 + R0-L13, MS-R0-3 D1/D2; lead review 3 R0-L27 + R0-L29). H-01 ("works
// offline") and PR-01 ("Works offline once this page has loaded") promise offline practice, so once the gate is
// passed, online, the app shell fetches everything the practice flow can still need — whatever screen the tab
// entered on (H-01, PR-01, S-01, or X-01 404 -> home: fix2 review 2 NB-1):
//   0. the PracticeScreen route chunk (loadPracticeScreen, the same import React.lazy uses in routes.tsx), so
//      "Practice" opens without a fetch,
//   1. game services: the session + ai chunk (composition.loadGameServices, cached for the page),
//   2. the tab's dealer Worker (prewarmPracticeHost) and metrics Worker (prewarmMetrics): both are spawned now,
//      awaited until each has answered, and reused by every later table, so Leave -> Practice -> "Deal me in"
//      fetches no Worker script again,
//   3. the font subsets of every glyph the flow can draw in the current language (below).
// Everything else the table draws is already here: TableScreen, the menu sheet, BetSizer, the result, refill and
// alert screens are static imports of the PracticeScreen chunk, and no sound is played.
// Where it runs (PracticeWarmup): GateRoute's passed branch, around every gated route (/app, /practice, /settings and
// the later 2-3/3-3/4-3 routes, so a /join tab warms the practice flow too — the lead's choice in review 3), and X-01,
// the one route outside the gate, when the notice was accepted on an earlier visit (GatePassedWarmup). Never before
// the notice (SS2 rule 3; GateRoute.test.tsx watches module evaluation).
// Steps 0-2 run once per tab (module state below; H-01 -> PR-01 -> S-01 repeats nothing). Step 3 runs again when
// the language or my nickname changes.
// Status (R0-L27, completed by R0-L36): PR-01 draws "Works offline once this page has loaded" only once all of these
// succeeded: both imports, BOTH Workers answered (prewarmPracticeHost() and prewarmMetrics() resolved true, so each
// script was fetched and runs — fix3 review: with 400 ms RTT the sentence used to be drawn ~400 ms before the
// Worker scripts arrived, and going offline then crashed "Deal me in"), and the fonts. Not while any of them is
// pending (MS-R0-3 run 2 D-R2-1), not after any failure or a false. Nothing waits on it: H-01 and PR-01 stay usable
// throughout.
// ponytail: "ready" proves the two Workers run in this tab, not that their scripts are cached: a reload while offline,
// or a Worker that crashes later (respawn = new fetch), still needs the network; precache the app and Worker chunks
// with a Service Worker if offline reload or offline crash recovery joins the requirements (same trigger as
// shared-host.ts / ai metrics client). A Worker load that hangs without an error keeps the sentence undrawn (their
// ponytails).
// ponytail: a failed attempt (a false prewarm included) is retried only when the shell warm-up mounts again
// (GateRoute remount, X-01 -> home) or the language/nickname changes, not when the network comes back; listen for
// the window 'online' event if a tab that passed the gate offline is reported, or an MS run covers it.
// ponytail: steps 0-2 are not repeated after a dealer Worker crash: the next table's acquire() spawns a new one
// (online only — shared-host.ts ponytail) while PR-01 still shows the sentence; reset the warm-up from
// PracticeScreen's crash path if offline crash recovery becomes a requirement.
// `scan-dist` S9 lists the dynamic imports and Worker scripts reachable from app.html in the built dist and fails on
// any that this warm-up does not cover (`practice_flow` in scan-allow.json; warmup.test.tsx and GateRoute.test.tsx
// tie that list to the calls made here).
//
// Fonts: the faces are unicode-range subsets downloaded on first use, so a glyph first drawn offline is a failed
// request and a console error ("→" in the result, "½ ¾" in BetSizer). document.fonts.load(font, text) fetches exactly
// the subsets `text` touches, for each family of the three token stacks (ui, display, mono — read from tokens.css at
// runtime, not repeated here), and rejects when one of them fails. The text is the whole dictionary of the language
// (every key the table, result, refill, menu, BetSizer, toasts and announcer can show, plus H-01 after Leave),
// printable ASCII (digits, Intl number output, card ranks, the dealer "D"), the few glyphs only code writes, and the
// names on this table (my nickname; house bot names are dictionary text plus digits).
// ponytail: warms the whole dictionary (ja: about 34 Pretendard subsets, ~1 MB, only two more than the table keys
// alone; most are already loaded by the gate and PR-01), narrow it to table key prefixes if the font budget is ever
// measured as a problem.
// ponytail: current language only (lead review 2 R0-L13, confirmed in review 3 N-1) — a language switched while
// offline draws in the fallback fonts and logs one failed request per new subset (Chrome, en -> ja: 16); warm every
// shipped language here (en users then fetch ~1 MB of ja subsets) if offline language switching joins the MS
// checklist or a user reports it.
// Failures are silent (no console output, no unhandled rejection): offline at the gate, a Worker that did not come up
// or a font error only means the table falls back as before and PR-01 does not make the promise; "Practice" and
// "Deal me in" fetch their chunk themselves (React.lazy makes its own import when /practice first renders;
// composition does not cache a failed import).
import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Lang } from '@checky/engine/protocol';
import { loadGameServices, type AppServices } from '../composition';
import { messageValues, useI18n } from '../i18n/useT';
import { useServices } from '../shell/ServicesProvider';

/** Printable ASCII: digits and separators of Intl output, card ranks, badges ("SB", "D"), shortcut keys. */
const ASCII = Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
/**
 * Glyphs written by code, not by the dictionary (· joins in PotDisplay/Seat/ActionBar, — BetSizer and LiveOdds
 * placeholders, − formatDelta's minus) and the symbols the lead review names for the table (→ ½ ¾ ≈ ±).
 */
export const CODE_GLYPHS = '·—−→½¾≈±';
const FONT_TOKENS = ['--font-ui', '--font-display', '--font-mono'] as const;

/** Every distinct character the practice flow can draw in `lang`, once each. */
export function practiceGlyphs(lang: Lang, names: readonly string[]): string {
  return [...new Set([...messageValues(lang), ASCII, CODE_GLYPHS, ...names].join(''))].join('');
}

/** Step 0: the PracticeScreen chunk. routes.tsx hands this same function to React.lazy. */
export const loadPracticeScreen = () => import('./PracticeScreen');

export type WarmupStatus = 'pending' | 'ready' | 'failed';

/** This tab's steps 0-2: one attempt shared by every caller; a failed attempt is forgotten so a later one can retry. */
let tabSteps: Promise<void> | null = null;

/**
 * Steps 0-2, once per tab. Rejects when the chunk or the game services cannot be loaded, or when a Worker did not
 * come up (prewarm() false: no Worker, or it crashed before its first answer — R0-L36).
 */
export function warmPracticeTab(services: AppServices): Promise<void> {
  tabSteps ??= Promise.all([loadPracticeScreen(), loadGameServices(services).then((game) => game.prewarm())])
    .then(([, workersUp]) => {
      if (!workersUp) throw new Error('practice Workers did not start');
    })
    .catch((e: unknown) => {
      tabSteps = null;
      throw e;
    });
  return tabSteps;
}

/** Test hook: forget this tab's warm-up (pair with composition.resetGameServicesForTest). */
export function resetPracticeWarmupForTest(): void {
  tabSteps = null;
}

/** Step 3. Resolves once every subset the text needs has loaded, rejects if one fails; no FontFaceSet = nothing to do. */
export function warmPracticeFonts(lang: Lang, names: readonly string[]): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  const text = practiceGlyphs(lang, names);
  const style = getComputedStyle(document.documentElement);
  const families = FONT_TOKENS.map((token) => style.getPropertyValue(token).trim()).filter((family) => family !== '');
  return Promise.all(families.map((family) => document.fonts.load(`16px ${family}`, text))).then(() => undefined);
}

const WarmupContext = createContext<WarmupStatus>('pending');

/**
 * The shell warm-up (steps 0-3) and its status for the screens inside it. Renders nothing of its own. A status
 * belongs to the language and nickname it was reached with, so a switch reads 'pending' until its fonts settle.
 */
export function PracticeWarmup({ children = null }: { children?: ReactNode }) {
  const { services, profile } = useServices();
  const { lang } = useI18n();
  const nickname = profile?.nickname ?? '';
  const key = `${lang}\n${nickname}`;
  const [settled, setSettled] = useState<{ key: string; status: WarmupStatus } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([warmPracticeTab(services), warmPracticeFonts(lang, [nickname])]).then(
      () => live && setSettled({ key, status: 'ready' }),
      () => live && setSettled({ key, status: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [services, lang, nickname, key]);
  const status = settled !== null && settled.key === key ? settled.status : 'pending';
  return createElement(WarmupContext.Provider, { value: status }, children);
}

/** True once the shell warm-up has settled without an error (PR-01 offline sentence, R0-L27). */
export function usePracticeOfflineReady(): boolean {
  return useContext(WarmupContext) === 'ready';
}

// A-APP-GATE — the wrapper every app route renders inside (only X-01 `*` sits outside). It is a layout element, not
// a route, so passing it never redirects: the URL the user opened (including /join after the fragment was moved by
// boot.ts) stays as it is (FS-GATE-6).
//
// Steps: G-01 notice (consent.get() !== NOTICE_VERSION) -> G-03 adult step (only if the UI language is listed in
// flags.ADULT_CHECK) -> P-01 nickname (no profile) -> the route. Consent is re-read on every render so a full wipe
// (4-3) sends the user back to G-01. Nothing on this path imports session or ai before the gate: once it is passed,
// PracticeWarmup (practice/warmup.ts) wraps the route and loads them for the tab through composition.loadGameServices
// (R0-L29: one shell warm-up, whichever gated screen the tab entered on), so relay and LLM code is not even evaluated
// before the notice is accepted.
import { useReducer, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { flags } from '@/config';
import type { StorageApi } from '@/storage';
import { AdultCheckSlot } from '../gate/AdultCheckSlot';
import { AgeBlockedScreen } from '../gate/AgeBlockedScreen';
import { DisclosureScreen } from '../gate/DisclosureScreen';
import { NicknameScreen } from '../gate/NicknameScreen';
import { NOTICE_VERSION } from '../gate/notice';
import { useT } from '../i18n/useT';
import { PracticeWarmup } from '../practice/warmup';
import { Banner } from '../ui/Banner';
import { GateLoading } from './GateLoading';
import { useServices } from './ServicesProvider';

function consentVersion(storage: StorageApi): number | null {
  try {
    return storage.consent.get()?.version ?? null;
  } catch {
    return null;
  }
}

export function adultCheckLangs(list: string): string[] {
  return list
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

export function GateRoute() {
  const t = useT();
  const { services, profile, lang } = useServices();
  const { pathname } = useLocation();
  // Tab-only memory: consent that could not be persisted (gate.storageWarn), the adult step, the under-18 screen.
  const [memoryConsent, setMemoryConsent] = useState(false);
  const [storageWarn, setStorageWarn] = useState(false);
  const [adultPassed, setAdultPassed] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  if (underage) return <AgeBlockedScreen />;

  const consented = memoryConsent || consentVersion(services.storage) === NOTICE_VERSION;
  if (!consented) {
    return (
      <DisclosureScreen
        destination={pathname}
        onAdult={() => {
          try {
            services.storage.consent.accept(NOTICE_VERSION);
          } catch {
            // fall through to the persisted check below
          }
          // Pass for this tab and warn when storage is failing. The real consent store keeps a refused localStorage
          // write in memory, so its read-back still matches; what reports the failure is the storage issue channel:
          // issue() is E-STO-UNAVAILABLE (the code ui-spec G-01 names) right after accept() returns (lead decision
          // R0-L2). The read-back check covers a store that throws instead. The same code also means "IndexedDB is
          // gone, consent saved", and no signal tells the two apart, so the copy is one neutral sentence that is true
          // for both ("we may ask again", R0-L23).
          const persisted = consentVersion(services.storage) === NOTICE_VERSION;
          if (!persisted) setMemoryConsent(true);
          if (!persisted || services.storage.issue() === 'E-STO-UNAVAILABLE') setStorageWarn(true);
          rerender();
        }}
        onUnderage={() => setUnderage(true)}
      />
    );
  }

  if (adultCheckLangs(flags.ADULT_CHECK).includes(lang) && !adultPassed) {
    return <AdultCheckSlot onContinue={() => setAdultPassed(true)} />;
  }

  if (profile === undefined) return <GateLoading />;
  if (profile === null) return <NicknameScreen />;

  return (
    <PracticeWarmup>
      {storageWarn ? (
        <div className="mx-auto w-full max-w-app px-4 pt-4">
          <Banner tone="warn" onDismiss={() => setStorageWarn(false)} dismissLabel={t('common.close')}>
            {t('gate.storageWarn')}
          </Banner>
        </div>
      ) : null}
      <Outlet />
    </PracticeWarmup>
  );
}

/**
 * The shell warm-up for X-01 (`*`), the one route outside GateRoute (NB-1: a tab opened on a mistyped URL, then
 * offline, then home -> Practice). It runs only when an earlier visit passed the gate, judged from storage alone: the
 * current notice version, no adult step for this language (that pass is GateRoute's tab memory), and a profile. A
 * visitor who has not accepted the notice loads nothing here (SS2 rule 3).
 */
export function GatePassedWarmup() {
  const { services, profile, lang } = useServices();
  const passed = consentVersion(services.storage) === NOTICE_VERSION && !adultCheckLangs(flags.ADULT_CHECK).includes(lang) && profile != null;
  return passed ? <PracticeWarmup /> : null;
}

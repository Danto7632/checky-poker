// App-wide state that outlives routes: the composition services, the local profile, the UI language and storage
// issues. Wraps I18nProvider so every screen gets `t` in the current language.
//
// Language rules (A-STO-LANG, D-A1): the boot language is storage.lang.get() ?? browser language; switching
// (G-01, TopBar, S-01) writes through profile.save({..., lang}) when a profile exists (storage updates cp.lang.v1
// in the same call) and through lang.set otherwise. The app never touches cp.lang.v1 itself.
//
// Profile writes (nickname/avatar save, language switch) run one after another, and each starts from the latest
// stored profile and the current language — never from a render's snapshot. Otherwise a language switch made while
// a nickname save is in flight writes the old nickname back, or the reverse (review m5; E2E `fill -> Tab ->
// selectOption` lands exactly in that window).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Lang } from '@checky/engine/protocol';
import { flags } from '@/config';
import type { LocalProfile, StorageIssue } from '@/storage';
import type { AppServices } from '../composition';
import { resolveLang } from '../i18n/lang';
import { I18nProvider } from '../i18n/useT';

interface ServicesValue {
  services: AppServices;
  /** null = no profile yet (P-01); undefined = still loading. */
  profile: LocalProfile | null | undefined;
  /** Saves with the current UI language. Rejects with `{code: 'E-PROFILE-NICK-INVALID'}` from storage. */
  saveProfile(p: { nickname: string; avatarSeed: number }): Promise<void>;
  lang: Lang;
  changeLanguage(lang: Lang): void;
  storageIssue: StorageIssue | null;
}

const ServicesContext = createContext<ServicesValue | null>(null);

function initialLang(services: AppServices): Lang {
  let stored: Lang | null = null;
  try {
    stored = services.storage.lang.get();
  } catch {
    stored = null; // unreadable storage: fall back to the browser language
  }
  return resolveLang(stored, typeof navigator === 'undefined' ? undefined : navigator.language, flags.FEATURE_KO);
}

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  const { storage } = services;
  const [profile, setProfile] = useState<LocalProfile | null | undefined>(undefined);
  const [lang, setLang] = useState<Lang>(() => initialLang(services));

  useEffect(() => {
    let live = true;
    storage.profile
      .get()
      .then((p) => live && setProfile(p))
      .catch(() => live && setProfile(null));
    return () => {
      live = false;
    };
  }, [storage]);

  // Bound wrappers: storage methods are not guaranteed to be free functions.
  const subscribeIssue = useCallback((cb: () => void) => storage.onIssue(() => cb()), [storage]);
  const storageIssue = useSyncExternalStore(subscribeIssue, () => storage.issue());

  // The language a queued write must use: set synchronously on a switch, before any re-render.
  const langRef = useRef(lang);
  // Tail of the profile write queue; it never rejects, so one failed write does not block the next.
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(task);
    writes.current = run.catch(() => undefined);
    return run;
  }, []);

  const saveProfile = useCallback(
    (p: { nickname: string; avatarSeed: number }) =>
      enqueue(async () => {
        const lang = langRef.current;
        await storage.profile.save({ nickname: p.nickname, avatarSeed: p.avatarSeed, lang });
        // Read back the stored (trimmed) value so every screen shows exactly what storage kept.
        const saved = await storage.profile.get();
        setProfile(saved ?? { nickname: p.nickname.trim(), avatarSeed: p.avatarSeed, lang, updatedAt: new Date().toISOString() });
      }),
    [storage, enqueue],
  );

  const changeLanguage = useCallback(
    (next: Lang) => {
      langRef.current = next;
      setLang(next);
      const persistLang = () => {
        try {
          storage.lang.set(next);
        } catch {
          // Not persisted; the choice still applies to this page.
        }
      };
      // Known "no profile yet" (G-01 before P-01): write cp.lang.v1 at once, nothing to serialise.
      if (profile === null) return persistLang();
      enqueue(async () => {
        const latest = await storage.profile.get();
        if (latest === null) return persistLang();
        await storage.profile.save({ nickname: latest.nickname, avatarSeed: latest.avatarSeed, lang: next });
        setProfile((await storage.profile.get()) ?? { ...latest, lang: next });
      }).catch(persistLang);
    },
    [storage, profile, enqueue],
  );

  const value = useMemo<ServicesValue>(
    () => ({ services, profile, saveProfile, lang, changeLanguage, storageIssue }),
    [services, profile, saveProfile, lang, changeLanguage, storageIssue],
  );
  return (
    <ServicesContext.Provider value={value}>
      <I18nProvider lang={lang}>{children}</I18nProvider>
    </ServicesContext.Provider>
  );
}

export function useServices(): ServicesValue {
  const value = useContext(ServicesContext);
  if (value === null) throw new Error('useServices must be used inside <ServicesProvider>');
  return value;
}

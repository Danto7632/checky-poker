// i18n runtime: dictionaries, interpolation and the React context (design-handoff section 5).
//
// en and ja are static imports; ko is a dynamic import behind flags.FEATURE_KO so it is a separate chunk that a
// default build never references. `t(key, vars)` replaces `{name}` placeholders with the given strings; callers pass
// numbers already formatted with Intl (table/format.ts), never raw numbers. A key missing from ko falls back to en.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Lang } from '@checky/engine/protocol';
import { flags } from '@/config';
import { en, type MessageKey } from './en';
import { ja } from './ja';

export type { MessageKey } from './en';
export type Vars = Readonly<Record<string, string>>;
export type TFunction = (key: MessageKey, vars?: Vars) => string;

// Assigning to Record<MessageKey, string> is the compile-time check that ja has every en key (US43 AC5).
const STATIC: Record<'en' | 'ja', Record<MessageKey, string>> = { en, ja };
let koDict: Readonly<Record<string, string>> | null = null;

/** Loads the ko dictionary once (only called when the flag is on). */
export async function loadKo(): Promise<void> {
  if (koDict !== null) return;
  koDict = (await import('./ko')).ko;
}

export function lookup(lang: Lang, key: string): string | undefined {
  if (lang === 'ko') return koDict?.[key] ?? (en as Record<string, string>)[key];
  return (STATIC[lang] as Record<string, string>)[key];
}

export function interpolate(template: string, vars: Vars | undefined): string {
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole);
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return interpolate(lookup(lang, key) ?? key, vars);
}

/** Every string the UI can show in `lang` (ko: its dictionary over the en fallback) — for font warm-up (R0-L13). */
export function messageValues(lang: Lang): string[] {
  if (lang === 'ko') return Object.values({ ...en, ...koDict });
  return Object.values(STATIC[lang]);
}

/** For keys built at runtime (err.<CODE>, rank.<code>): falls back to `fallback` when the key does not exist. */
export function translateDynamic(lang: Lang, key: string, vars?: Vars, fallback?: MessageKey): string {
  const found = lookup(lang, key);
  if (found !== undefined) return interpolate(found, vars);
  return fallback === undefined ? key : translate(lang, fallback, vars);
}

interface I18nValue {
  lang: Lang;
  t: TFunction;
  /** Runtime-built keys (err.<CODE>, rank.<code>, card.suit.<s>). */
  td: (key: string, vars?: Vars) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  // ko must be loaded before the first render in ko; render en until then (one frame, flag builds only).
  const [koReady, setKoReady] = useState(koDict !== null);
  useEffect(() => {
    if (flags.FEATURE_KO && !koReady) void loadKo().then(() => setKoReady(true));
  }, [koReady]);
  const effective: Lang = lang === 'ko' && !koReady ? 'en' : lang;

  // <html lang> follows the UI language (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = effective;
  }, [effective]);

  const value = useMemo<I18nValue>(
    () => ({
      lang: effective,
      t: (key, vars) => translate(effective, key, vars),
      td: (key, vars) => translateDynamic(effective, key, vars),
    }),
    [effective],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

export function useT(): TFunction {
  return useI18n().t;
}

/** The ko language name, available once the ko chunk is loaded (flag builds only). */
export function koLanguageName(): string | undefined {
  return koDict?.['lang.name.ko'];
}

// UI language resolution (SS27, A-STO-LANG / D-A1).
//
// Order: the stored choice (storage.lang.get(), synchronous) wins; otherwise the browser language — ja* -> ja,
// ko* -> ko only when the ko flag is on, anything else -> en. A stored 'ko' in a build without ko falls through
// to the browser rule (the user cannot pick ko there, so the value is stale).
import type { Lang } from '@checky/engine/protocol';

export type UiLang = Lang;

export function resolveLang(stored: Lang | null, browserLanguage: string | undefined, koEnabled: boolean): Lang {
  if (stored === 'en' || stored === 'ja') return stored;
  if (stored === 'ko' && koEnabled) return 'ko';
  const tag = (browserLanguage ?? '').toLowerCase();
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  if (koEnabled && (tag === 'ko' || tag.startsWith('ko-'))) return 'ko';
  return 'en';
}

/** Languages the user can pick in this build (US43 AC1: English and 日本語 only while ko is off). */
export function selectableLangs(koEnabled: boolean): Lang[] {
  return koEnabled ? ['en', 'ja', 'ko'] : ['en', 'ja'];
}

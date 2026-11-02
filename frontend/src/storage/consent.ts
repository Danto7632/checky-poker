// Synchronous Web Storage parts (storage.webstorage.v1): cp.consent.v1 and cp.lang.v1 in localStorage.
// They are synchronous so boot can decide gate and language before the first paint (AP11, S11-F10).
//
// localStorage can throw (disabled storage, some private modes, quota). A failed write keeps the value in
// memory for this page so the session behaves consistently; a failed read counts as "nothing stored".
// A failed CONSENT write is also reported through `onWriteFailed` (index.ts maps it to the storage banner
// channel as E-STO-UNAVAILABLE, lead decision R0-L2) so G-01 can say the consent lasts for this tab only.
// A failed lang write stays silent: the language still applies to this page and R0-L2 covers consent only.
import type { Lang } from '@checky/engine/record';
import type { ConsentStore, LangStore } from './types';

const CONSENT_KEY = 'cp.consent.v1';
const LANG_KEY = 'cp.lang.v1';
// storage may not import the protocol enums; Record<Lang, true> makes a new Lang a compile error here.
const LANG_SET: Record<Lang, true> = { en: true, ja: true, ko: true };

function read(ls: Storage | undefined, key: string): string | null {
  try {
    return ls?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write. */
function write(ls: Storage | undefined, key: string, value: string | null): boolean {
  try {
    if (ls === undefined) return false;
    if (value === null) ls.removeItem(key);
    else ls.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function createConsentStore(ls: Storage | undefined, onWriteFailed: () => void): ConsentStore {
  // undefined = not overridden in memory; null = cleared.
  let memory: { version: number; acceptedAt: string } | null | undefined;
  const persist = (value: string | null): boolean => {
    const ok = write(ls, CONSENT_KEY, value);
    if (!ok) onWriteFailed();
    return ok;
  };
  return {
    get() {
      if (memory !== undefined) return memory;
      const raw = read(ls, CONSENT_KEY);
      if (raw === null) return null;
      try {
        const v: unknown = JSON.parse(raw);
        if (typeof v === 'object' && v !== null) {
          const { version, acceptedAt } = v as { version?: unknown; acceptedAt?: unknown };
          if (Number.isInteger(version) && typeof acceptedAt === 'string') return { version: version as number, acceptedAt };
        }
      } catch {
        // A corrupt value is treated as "not accepted": the gate shows again, which is the safe side.
      }
      return null;
    },
    accept(version) {
      if (!Number.isInteger(version) || version < 1) throw new TypeError('consent version must be a positive integer');
      const value = { version, acceptedAt: new Date().toISOString() };
      memory = persist(JSON.stringify(value)) ? undefined : value;
    },
    clear() {
      memory = persist(null) ? undefined : null;
    },
  };
}

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && Object.hasOwn(LANG_SET, v);
}

export function createLangStore(ls: Storage | undefined): LangStore {
  let memory: Lang | undefined;
  return {
    get() {
      if (memory !== undefined) return memory;
      const raw = read(ls, LANG_KEY);
      return isLang(raw) ? raw : null;
    },
    set(lang) {
      if (!isLang(lang)) throw new TypeError('unknown language');
      memory = write(ls, LANG_KEY, lang) ? undefined : lang;
    },
  };
}

// storage — IndexedDB records/settings/profile/device secret + Web Storage consent/lang (api.storage.v1, R0 part).
//
// createStorage() is called once by app/composition.ts (AF-17). It starts opening IndexedDB immediately and every
// async API awaits that one promise. When IndexedDB cannot be opened the same API runs on an in-memory backend and
// issue() reports E-STO-UNAVAILABLE; a quota failure rejects that one write with E-STO-QUOTA and reports it; a
// version change blocked by another tab reports E-STO-BLOCKED. A consent write that localStorage refuses also
// reports E-STO-UNAVAILABLE (R0-L2: consent then lasts for this tab only). The game never stops for storage (SC3).
// E-STO-UNAVAILABLE is terminal for this page: something now lives in memory only, and a later QUOTA/BLOCKED
// (or a QUOTA recovery) must not hide that from the banner.
// 4-1 adds exportAll/importAll/wipeAll to the returned object (additive).
import { CheckyError } from '@checky/engine/util';
import { createConsentStore, createLangStore } from './consent';
import { createMemoryBackend, openIdbBackend, type Backend } from './db';
import { createDeviceStore } from './device';
import { createHandStore } from './hands';
import { createProfileStore } from './profile';
import { createSettingsStore } from './settings';
import type { StorageApi, StorageIssue } from './types';

export type {
  AppSettings,
  ConsentStore,
  DeviceStore,
  HandListItem,
  HandStore,
  LangStore,
  LocalProfile,
  ProfileStore,
  SettingsStore,
  StorageApi,
  StorageIssue,
} from './types';

export interface CreateStorageOptions {
  /** Test injection. An explicit `undefined` means "this browser has no IndexedDB" (memory backend). */
  indexedDB?: IDBFactory | undefined;
  localStorage?: Storage | undefined;
  /** Accepted for the contract shape; used by 4-1 (wipe). */
  sessionStorage?: Storage;
}

function globalLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Accessing localStorage itself throws in some sandboxed contexts.
    return undefined;
  }
}

function requestPersist(): void {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (typeof storage?.persist !== 'function') return;
  // Best effort: the browser may refuse silently; behaviour is identical either way (data-model quota).
  storage.persist().then(
    () => undefined,
    () => undefined,
  );
}

export function createStorage(opts: CreateStorageOptions = {}): StorageApi {
  const factory = 'indexedDB' in opts ? opts.indexedDB : globalThis.indexedDB;
  const ls = 'localStorage' in opts ? opts.localStorage : globalLocalStorage();

  let issue: StorageIssue | null = null;
  const listeners = new Set<(i: StorageIssue | null) => void>();
  const setIssue = (next: StorageIssue | null): void => {
    if (issue === next || issue === 'E-STO-UNAVAILABLE') return;
    issue = next;
    for (const l of [...listeners]) l(next);
  };

  let current: Promise<Backend>;
  if (factory === undefined) {
    setIssue('E-STO-UNAVAILABLE');
    current = Promise.resolve(createMemoryBackend());
  } else {
    current = openIdbBackend(factory, {
      onBlocked: () => setIssue('E-STO-BLOCKED'),
      onVersionChange: () => {
        // A newer version opened in another tab: this connection is closed, keep the game going in memory.
        current = Promise.resolve(createMemoryBackend());
        setIssue('E-STO-BLOCKED');
      },
    }).then(
      (b) => {
        if (issue === 'E-STO-BLOCKED') setIssue(null);
        return b;
      },
      () => {
        setIssue('E-STO-UNAVAILABLE');
        return createMemoryBackend();
      },
    );
  }
  const backend = (): Promise<Backend> => current;

  const lang = createLangStore(ls);
  const hands = createHandStore(backend, { afterFirstWrite: requestPersist });
  return {
    profile: createProfileStore(backend, lang),
    device: createDeviceStore(backend),
    settings: createSettingsStore(backend),
    consent: createConsentStore(ls, () => setIssue('E-STO-UNAVAILABLE')),
    lang,
    hands: {
      ...hands,
      async put(rec) {
        try {
          await hands.put(rec);
          if (issue === 'E-STO-QUOTA') setIssue(null);
        } catch (e) {
          // Only this record is lost; the game goes on (exceptions 2.6).
          if (e instanceof CheckyError && e.code === 'E-STO-QUOTA') setIssue('E-STO-QUOTA');
          throw e;
        }
      },
    },
    issue: () => issue,
    onIssue(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// In-memory StorageApi with the same shape as @/storage (api.storage.v1, R0 part) — a test double for screen tests
// (the app uses createStorage from @/storage). Nothing survives a reload.
//
// It keeps the contract behaviours screens depend on: consent/lang are synchronous, profile.save validates the
// nickname with the shared rule and also writes lang (S11-F07), settings.patch rejects forbidden fields.
import { normalizeNickname, type Lang } from '@checky/engine/protocol';
import { defaults } from '@/config';
import type { AppSettings, LocalProfile, StorageApi, StorageIssue } from '@/storage';

const FORBIDDEN = new Set(['apiKey', 'key', 'secret', 'token']);

function hasForbidden(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([k, v]) => FORBIDDEN.has(k) || hasForbidden(v));
}

export const DEFAULT_SETTINGS: AppSettings = {
  sound: false,
  liveEquityPractice: true,
  lastRoomSettings: null,
  lastPracticeBots: null,
  providerModels: {},
  llmCap: 300,
};

export interface MemoryStorage extends StorageApi {
  /** Test helper: simulate an issue (E-STO-UNAVAILABLE ...). */
  setIssue(issue: StorageIssue | null): void;
}

export function createMemoryStorage(seed: { profile?: LocalProfile | null; consentVersion?: number | null; lang?: Lang | null } = {}): MemoryStorage {
  let profile: LocalProfile | null = seed.profile ?? null;
  let consent: { version: number; acceptedAt: string } | null =
    seed.consentVersion == null ? null : { version: seed.consentVersion, acceptedAt: '2026-11-01T00:00:00.000Z' };
  let lang: Lang | null = seed.lang ?? null;
  let settings: AppSettings = { ...DEFAULT_SETTINGS };
  let issue: StorageIssue | null = null;
  const issueListeners = new Set<(i: StorageIssue | null) => void>();

  return {
    profile: {
      get: () => Promise.resolve(profile === null ? null : { ...profile }),
      save: (p) => {
        const nickname = normalizeNickname(p.nickname, defaults.DV16);
        // Same failure shape as CheckyError (app code matches on `code`, never on the class).
        if (nickname === null) return Promise.reject(Object.assign(new Error('E-PROFILE-NICK-INVALID'), { code: 'E-PROFILE-NICK-INVALID' }));
        profile = { nickname, avatarSeed: p.avatarSeed, lang: p.lang, updatedAt: new Date().toISOString() };
        lang = p.lang;
        return Promise.resolve();
      },
    },
    device: {
      getSecret: () => Promise.resolve(new Uint8Array(32)),
      roomPlayerKey: () => Promise.resolve('memory-rpk-00000000000'),
      regenerate: () => Promise.resolve(),
    },
    settings: {
      get: () => Promise.resolve({ ...settings }),
      patch: (partial) => {
        if (hasForbidden(partial)) return Promise.reject(new TypeError('forbidden settings field'));
        settings = { ...settings, ...partial };
        return Promise.resolve({ ...settings });
      },
    },
    consent: {
      get: () => (consent === null ? null : { ...consent }),
      accept: (version) => {
        consent = { version, acceptedAt: new Date().toISOString() };
      },
      clear: () => {
        consent = null;
      },
    },
    lang: {
      get: () => lang,
      set: (l) => {
        lang = l;
      },
    },
    hands: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      list: () => Promise.resolve({ items: [], next: null }),
      count: () => Promise.resolve(0),
    },
    issue: () => issue,
    onIssue: (listener) => {
      issueListeners.add(listener);
      return () => issueListeners.delete(listener);
    },
    setIssue: (next) => {
      issue = next;
      for (const l of issueListeners) l(next);
    },
  };
}

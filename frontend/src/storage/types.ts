// Public shapes of the storage module (api.storage.v1, storage.idb.v1, storage.webstorage.v1 — R0 part).
//
// Sync rule (S11-F10): only the localStorage-backed parts (consent, lang) are synchronous; everything that
// touches IndexedDB or crypto.subtle returns a Promise. 4-1 adds exportAll/importAll/wipeAll to StorageApi
// (additive only) and the mode/favorite filters, setFavorite and attachCoaching to HandStore.
import type {
  BotSpec,
  Card,
  HandRecordV1,
  Lang,
  ProviderId,
  RecordMode,
  RoomSettings,
} from '@checky/engine/record';

export interface LocalProfile {
  nickname: string;
  avatarSeed: number;
  lang: Lang;
  /** ISO 8601 */
  updatedAt: string;
}

export interface AppSettings {
  sound: boolean;
  liveEquityPractice: boolean;
  lastRoomSettings: RoomSettings | null;
  lastPracticeBots: BotSpec[] | null;
  providerModels: Partial<Record<ProviderId, string>>;
  llmCap: number;
}

export interface HandListItem {
  id: string;
  playedAt: string;
  mode: RecordMode;
  myPosition: string | null;
  myCards: [Card, Card] | null;
  myNet: number | null;
  favorite: boolean;
  botCount: number;
}

export interface ProfileStore {
  get(): Promise<LocalProfile | null>;
  /** Throws CheckyError('E-PROFILE-NICK-INVALID'). Also writes cp.lang.v1 with the same language. */
  save(p: { nickname: string; avatarSeed: number; lang: Lang }): Promise<void>;
}

export interface LangStore {
  get(): Lang | null;
  set(lang: Lang): void;
}

export interface DeviceStore {
  /** 32 bytes, created on first use, never exported. */
  getSecret(): Promise<Uint8Array>;
  /** rpk = b64url(SHA-256('checky/rpk/v1' || secret || roomCode))[0..22] */
  roomPlayerKey(code: string): Promise<string>;
  regenerate(): Promise<void>;
}

export interface SettingsStore {
  get(): Promise<AppSettings>;
  /** Throws TypeError when `partial` carries a forbidden field (apiKey, key, secret, token) at any depth. */
  patch(partial: Partial<AppSettings>): Promise<AppSettings>;
}

export interface ConsentStore {
  get(): { version: number; acceptedAt: string } | null;
  accept(version: number): void;
  clear(): void;
}

export interface HandStore {
  /** playedAt must be filled (TypeError on ''). Re-saving the same id keeps the stored fav and coaching. */
  put(rec: HandRecordV1): Promise<void>;
  get(id: string): Promise<HandRecordV1 | null>;
  /** Newest first (by_time). `cursor` is opaque; pass back `next` to continue. limit is 1..50 (default 50). */
  list(opts?: { cursor?: string; limit?: number }): Promise<{ items: HandListItem[]; next: string | null }>;
  count(): Promise<number>;
}

/**
 * Storage problems the app shows as a banner (E-STO-UNAVAILABLE at open or when localStorage refuses the consent
 * write — R0-L2, E-STO-QUOTA per failed write, E-STO-BLOCKED on a version change blocked by another tab).
 * E-STO-UNAVAILABLE never changes once set. The game keeps running in every case.
 */
export type StorageIssue = 'E-STO-UNAVAILABLE' | 'E-STO-QUOTA' | 'E-STO-BLOCKED';

export interface StorageApi {
  profile: ProfileStore;
  device: DeviceStore;
  settings: SettingsStore;
  consent: ConsentStore;
  lang: LangStore;
  hands: HandStore;
  /** Current issue, or null. Updated asynchronously (IndexedDB opens lazily). */
  issue(): StorageIssue | null;
  /** Called on every issue change; returns unsubscribe. */
  onIssue(listener: (issue: StorageIssue | null) => void): () => void;
}

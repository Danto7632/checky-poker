// settings store (A-STO-SETTINGS, Q-014/D-P9): one row {key:'app', values: AppSettings}. API keys live only in
// Web Storage under ai/keys (ADR-0009), so a settings value carrying a key-like field is a programming error:
// assertNoForbiddenFields rejects apiKey/key/secret/token anywhere under `values` (nested included) — the row's
// own `key: 'app'` is the keyPath and is not part of values. 4-1 importAll reuses the same function.
import { defaults } from '@/config';
import type { Backend } from './db';
import type { AppSettings, SettingsStore } from './types';

export const FORBIDDEN_FIELDS: readonly string[] = ['apiKey', 'key', 'secret', 'token'];

/** Throws TypeError naming the path of the first forbidden field found (values are not echoed). */
export function assertNoForbiddenFields(values: unknown, path = 'values'): void {
  if (Array.isArray(values)) {
    values.forEach((v, i) => assertNoForbiddenFields(v, `${path}[${i}]`));
    return;
  }
  if (typeof values !== 'object' || values === null) return;
  for (const [k, v] of Object.entries(values)) {
    if (FORBIDDEN_FIELDS.includes(k)) throw new TypeError(`forbidden settings field at ${path}.${k}`);
    assertNoForbiddenFields(v, `${path}.${k}`);
  }
}

export function defaultSettings(): AppSettings {
  return {
    sound: false,
    liveEquityPractice: defaults.DV27.practice,
    lastRoomSettings: null,
    lastPracticeBots: null,
    providerModels: {},
    llmCap: defaults.DV10,
  };
}

const KNOWN: readonly (keyof AppSettings)[] = Object.keys(defaultSettings()) as (keyof AppSettings)[];

export function createSettingsStore(backend: () => Promise<Backend>): SettingsStore {
  const read = async (): Promise<AppSettings> => {
    const row = await (await backend()).get('settings', 'app');
    const stored = row?.values;
    const base = defaultSettings();
    if (typeof stored !== 'object' || stored === null) return base;
    // Unknown stored keys are dropped; missing keys fall back to defaults (forward-compatible reads).
    const out: Record<string, unknown> = { ...base };
    for (const k of KNOWN) if (Object.hasOwn(stored, k)) out[k] = (stored as Record<string, unknown>)[k];
    return out as unknown as AppSettings;
  };
  return {
    get: read,
    async patch(partial) {
      assertNoForbiddenFields(partial);
      for (const k of Object.keys(partial)) {
        if (!(KNOWN as readonly string[]).includes(k)) throw new TypeError(`unknown settings field ${k}`);
      }
      const next: AppSettings = { ...(await read()), ...partial };
      assertNoForbiddenFields(next);
      await (await backend()).put('settings', { key: 'app', values: next });
      return next;
    },
  };
}

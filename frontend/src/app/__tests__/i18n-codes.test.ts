// C11 i18n contract test (build-plan section 3, US43 AC5, D-A6): against config/contract-codes.json —
// every non-silent error (53) has err.<CODE> and every notice (13) has notice.<CODE>, in en and ja; ja and en have
// the same key set; no i18n key or source string names a code the contract does not define. Silent codes (14) are
// exempt. The ui-spec screen keys that alias an err/notice key must hold the same string.
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';

interface Codes {
  errors: { id: string; surface: string }[];
  notices: { id: string }[];
}
// Read as data through Vite (the lead's JSON is the repository copy of the contract code lists).
const codes = Object.values(import.meta.glob('../../config/contract-codes.json', { eager: true, import: 'default' }))[0] as Codes;
const sources = {
  ...import.meta.glob(['../../**/*.{ts,tsx}', '!../../app/legacy/**', '!../../**/__tests__/**', '!../../**/*.test.{ts,tsx}'], { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob(['../../../../packages/*/src/**/*.ts', '!../../../../packages/*/src/**/*.test.ts'], { eager: true, query: '?raw', import: 'default' }),
} as Record<string, string>;
const errorIds = new Set(codes.errors.map((e) => e.id));
const noticeIds = new Set(codes.notices.map((n) => n.id));
const required = codes.errors.filter((e) => e.surface !== 'silent');
const dicts = { en: en as Record<string, string>, ja: ja as Record<string, string> };

describe('C11 contract codes -> i18n', () => {
  it('covers 53 non-silent errors + 13 notices = 66, silent 14 exempt', () => {
    expect(required).toHaveLength(53);
    expect(codes.notices).toHaveLength(13);
    expect(codes.errors.length - required.length).toBe(14);
  });

  it.each(['en', 'ja'] as const)('%s has err.<CODE> for every non-silent error and notice.<CODE> for every notice', (lang) => {
    const d = dicts[lang];
    const missing = [
      ...required.map((e) => `err.${e.id}`),
      ...codes.notices.map((n) => `notice.${n.id}`),
    ].filter((k) => typeof d[k] !== 'string' || d[k]!.trim() === '');
    expect(missing).toEqual([]);
  });

  it('ja and en have exactly the same keys', () => {
    const enKeys = Object.keys(en).sort();
    const jaKeys = Object.keys(ja).sort();
    expect(jaKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys.filter((k) => !jaKeys.includes(k))).toEqual([]);
  });

  it('no err./notice. key names an undefined code', () => {
    for (const d of Object.values(dicts)) {
      for (const key of Object.keys(d)) {
        const err = /^err\.(E-[A-Z-]+?)(?:\.|$)/.exec(key);
        if (err) expect(errorIds.has(err[1]!), key).toBe(true);
        const notice = /^notice\.(N-[A-Z-]+?)(?:\.|$)/.exec(key);
        if (notice) expect(noticeIds.has(notice[1]!), key).toBe(true);
      }
    }
  });

  it('every E-/N- code string in app and package sources is a contract code (legacy and tests excluded)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
    const unknown: string[] = [];
    for (const [f, src] of Object.entries(sources)) {
      // A token followed by "-" or "*" is a prefix ('E-NET-', E-JOIN-*), not a code.
      for (const m of src.matchAll(/\bE-[A-Z][A-Z-]*[A-Z]\b(?![-*])/g)) if (!errorIds.has(m[0])) unknown.push(`${f}: ${m[0]}`);
      for (const m of src.matchAll(/\bN-[A-Z][A-Z-]*[A-Z]\b(?![-*])/g)) if (!noticeIds.has(m[0])) unknown.push(`${f}: ${m[0]}`);
    }
    expect(unknown).toEqual([]);
  });

  it('screen alias keys hold the same string as their canonical err./notice. key (design-handoff section 5)', () => {
    const aliases: [string, string][] = [
      ['err.E-ACT-NOT-YOUR-TURN', 'act.err.notYourTurn'],
      ['err.E-ACT-ILLEGAL', 'act.err.illegal'],
      ['err.E-ACT-AMOUNT', 'sizer.err.min'],
      ['err.E-GATE-UNDERAGE', 'gate.minor.title'],
      ['err.E-PROFILE-NICK-INVALID', 'profile.hint'],
      ['err.E-STO-UNAVAILABLE', 'storage.unavailable'],
      ['err.E-UI-NOT-FOUND', 'notFound.title'],
      ['err.E-UI-BOOT', 'boot.title'],
      ['err.E-WORKER-CRASH', 'practice.crash.title'],
      ['err.E-ENG-INVARIANT', 'invariant.title'],
      ['err.E-LLM-CAP', 'notice.N-LLM-CAP'],
      ['notice.N-REFILL-HINT', 'refill.title'],
    ];
    for (const d of Object.values(dicts)) for (const [canonical, alias] of aliases) expect(d[alias], alias).toBe(d[canonical]);
  });
});

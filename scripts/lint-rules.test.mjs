// Tooling test for the root eslint.config.js (story 0-0 AC-4). Run with: node --test scripts/lint-rules.test.mjs
//
// Samples are linted in memory with ESLint.lintText(code, {filePath}); no violating file lives in a product folder.
// The expectations below are transcribed from code-structure.md section 3 (table A) and section 5 on purpose,
// independently of how eslint.config.js generates its rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Product paths in samples do not exist on disk, so type-aware parsing (projectService) cannot run for them.
// This instance keeps every other rule exactly as configured and only switches the type-aware part off.
const syntaxOnly = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      languageOptions: { parserOptions: { projectService: false } },
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
      },
    },
  ],
});
// The real config on real fixture files (scripts/lint-fixtures is ignored by `eslint .` but not by this instance).
const typeAware = new ESLint({ cwd: root, ignore: false });

async function lint(code, filePath, linter = syntaxOnly) {
  const [result] = await linter.lintText(code, { filePath });
  const fatal = result.messages.filter((m) => m.fatal);
  assert.equal(fatal.length, 0, `parse error in sample for ${filePath}: ${fatal.map((m) => m.message).join('; ')}`);
  return result.messages.filter((m) => m.severity === 2);
}
const rulesOf = (messages) => [...new Set(messages.map((m) => m.ruleId))];
const has = (messages, ruleId, re) => messages.some((m) => m.ruleId === ruleId && (re === undefined || re.test(m.message)));

async function assertErrors(code, filePath, ruleId, re) {
  const messages = await lint(code, filePath);
  assert.ok(has(messages, ruleId, re), `expected ${ruleId}${re ? ` /${re.source}/` : ''} for ${filePath}\n${code}\ngot: ${JSON.stringify(messages.map((m) => [m.ruleId, m.message]))}`);
}
async function assertClean(code, filePath) {
  const messages = await lint(code, filePath);
  assert.deepEqual(
    messages.map((m) => [m.ruleId, m.message]),
    [],
    `expected no errors for ${filePath}\n${code}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// A. Import boundaries — table A, every cell
// ---------------------------------------------------------------------------------------------------------------
const ENGINE = ['@checky/engine', '@checky/engine/table', '@checky/engine/projection', '@checky/engine/record', '@checky/engine/protocol', '@checky/engine/util'];
const ANALYSIS = '@checky/analysis';
const MODULES = ['config', 'net', 'host', 'session', 'storage', 'share', 'ai', 'app'];
const ALL_SPECS = [...ENGINE, ANALYSIS, ...MODULES.map((m) => `@/${m}`)];
const e = (...names) => names.map((n) => `@checky/engine/${n}`);

// value: value imports allowed (type imports too). type: only `import type` allowed. Everything else is forbidden.
const TABLE_A = {
  'packages/engine/src/x.ts': { value: ENGINE, type: [] },
  'packages/analysis/src/x.ts': { value: [...ENGINE, ANALYSIS], type: [] },
  'frontend/src/host/x.ts': { value: [...ENGINE, ANALYSIS, '@/config', '@/host'], type: [] },
  'frontend/src/net/x.ts': { value: [...e('protocol', 'util'), '@/config', '@/net'], type: [] },
  'frontend/src/session/x.ts': { value: [...ENGINE, '@/config', '@/net', '@/host', '@/session'], type: ['@/storage'] },
  'frontend/src/storage/x.ts': { value: [...e('record', 'util'), '@/config', '@/storage'], type: [] },
  'frontend/src/share/x.ts': { value: [...e('record', 'util'), '@/config', '@/share'], type: [] },
  'frontend/src/ai/x.ts': { value: [...e('util'), ANALYSIS, '@/config', '@/ai'], type: ['@checky/engine', ...e('table', 'projection', 'record', 'protocol')] },
  'frontend/src/app/home/x.tsx': { value: [...e('protocol', 'record'), '@/config', '@/session', '@/storage', '@/share', '@/ai', '@/app'], type: [ANALYSIS] },
};

describe('A. import boundaries (table A)', () => {
  for (const [filePath, { value, type }] of Object.entries(TABLE_A)) {
    test(`${filePath}: every module column`, async () => {
      for (const spec of ALL_SPECS) {
        const valueOk = value.includes(spec);
        const typeOk = valueOk || type.includes(spec);
        const asValue = await lint(`import { a } from '${spec}';\nexport const b = a;\n`, filePath);
        const asType = await lint(`import type { A } from '${spec}';\nexport type B = A;\n`, filePath);
        assert.equal(has(asValue, 'no-restricted-imports'), !valueOk, `${filePath}: value import of ${spec} should be ${valueOk ? 'allowed' : 'an error'}`);
        assert.equal(has(asType, 'no-restricted-imports'), !typeOk, `${filePath}: type import of ${spec} should be ${typeOk ? 'allowed' : 'an error'}`);
      }
    });
  }

  test('deep paths of another module are errors from every directory; own deep paths are fine', async () => {
    for (const filePath of Object.keys(TABLE_A)) {
      const self = filePath.match(/frontend\/src\/([a-z]+)\//)?.[1];
      for (const mod of MODULES) {
        const messages = await lint(`import { a } from '@/${mod}/internal';\nexport const b = a;\n`, filePath);
        assert.equal(has(messages, 'no-restricted-imports'), mod !== self, `${filePath} -> @/${mod}/internal`);
      }
    }
  });

  test('relative paths cannot bypass the boundary', async () => {
    await assertErrors("import { a } from '../net/trystero';\nexport const b = a;\n", 'frontend/src/session/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../../net/trystero';\nexport const b = a;\n", 'frontend/src/session/deep/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../storage/db';\nexport const b = a;\n", 'frontend/src/session/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../session';\nexport const b = a;\n", 'frontend/src/host/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../ai/keys/key-store';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx', 'no-restricted-imports');
    await assertErrors("import { a } from '../../../packages/engine/src/hand/apply';\nexport const b = a;\n", 'frontend/src/session/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../../engine/src/hand/apply';\nexport const b = a;\n", 'packages/analysis/src/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../../../frontend/src/config';\nexport const b = a;\n", 'packages/engine/src/x.ts', 'no-restricted-imports');
    // index through a relative path is the same public entry as the alias
    await assertClean("import { a } from '../net';\nexport const b = a;\n", 'frontend/src/session/x.ts');
    await assertClean("import { a } from '../host';\nexport const b = a;\n", 'frontend/src/session/x.ts');
  });

  test('allowed cells from the story: app -> session index, session -> host index, analysis -> engine', async () => {
    await assertClean("import { a } from '@/session';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx');
    await assertClean("import { a } from '@/host';\nexport const b = a;\n", 'frontend/src/session/x.ts');
    await assertClean("import { a } from '@checky/engine';\nexport const b = a;\n", 'packages/analysis/src/x.ts');
    await assertClean("import { a } from './local';\nexport const b = a;\n", 'frontend/src/session/x.ts');
    await assertClean("import { a } from '@/session/fake';\nexport const b = a;\n", 'frontend/src/session/x.ts');
    await assertClean("import { a } from '@/app/home/Card';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx');
  });

  test('test files may import @/host/testing, @/net/loopback and the engine test helpers; product files may not', async () => {
    const helpers = '../../../packages/engine/test/helpers/card-leak';
    for (const spec of ['@/host/testing', '@/net/loopback', helpers]) {
      const code = `import { a } from '${spec}';\nexport const b = a;\n`;
      await assertClean(code, 'frontend/src/session/x.test.ts');
      await assertClean(code, 'frontend/src/app/home/x.test.tsx');
      await assertErrors(code, 'frontend/src/session/x.ts', 'no-restricted-imports');
    }
    await assertClean("import { a } from '../../engine/test/helpers/card-leak';\nexport const b = a;\n", 'packages/analysis/test/x.test.ts');
    // the exception is exactly these entries
    await assertErrors("import { a } from '@/host/shell';\nexport const b = a;\n", 'frontend/src/session/x.test.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '@/net/trystero';\nexport const b = a;\n", 'frontend/src/session/x.test.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '../../../packages/engine/src/hand/apply';\nexport const b = a;\n", 'frontend/src/session/x.test.ts', 'no-restricted-imports');
  });

  test('internal paths of other modules and legacy are errors', async () => {
    await assertErrors("import { a } from '@/net/trystero';\nexport const b = a;\n", 'frontend/src/session/x.ts', 'no-restricted-imports');
    await assertErrors("import { a } from '@/ai/keys/key-store';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx', 'no-restricted-imports');
    await assertErrors("import { a } from '@/app/legacy/api';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx', 'no-restricted-imports', /legacy/);
    await assertErrors("import { a } from '../legacy/auth';\nexport const b = a;\n", 'frontend/src/app/home/x.tsx', 'no-restricted-imports', /legacy/);
    await assertErrors("import { a } from './legacy';\nexport const b = a;\n", 'frontend/src/app/x.tsx', 'no-restricted-imports', /legacy/);
    await assertErrors("import { a } from '../app/legacy/routes';\nexport const b = a;\n", 'frontend/src/net/x.ts', 'no-restricted-imports');
    await assertErrors("export { a } from '@/net/trystero';\n", 'frontend/src/session/x.ts', 'no-restricted-imports');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B. Global bans
// ---------------------------------------------------------------------------------------------------------------
describe('B. global bans', () => {
  test('Math.random is an error in product code and in tests; an eslint-disable with a reason is the only exception', async () => {
    for (const filePath of ['frontend/src/app/x.tsx', 'frontend/src/net/x.ts', 'packages/engine/src/x.ts', 'frontend/src/session/x.test.ts']) {
      await assertErrors('export const r = Math.random();\n', filePath, 'no-restricted-properties', /Math\.random/);
    }
    await assertClean('// eslint-disable-next-line no-restricted-properties -- avatar flourish only\nexport const r = Math.random();\n', 'frontend/src/app/x.tsx');
  });

  test('dangerouslySetInnerHTML (JSX), innerHTML, outerHTML, insertAdjacentHTML are errors', async () => {
    await assertErrors('export const A = ({ h }: { h: string }) => <div dangerouslySetInnerHTML={{ __html: h }} />;\n', 'frontend/src/app/x.tsx', 'no-restricted-syntax', /dangerouslySetInnerHTML/);
    await assertErrors('export function f(el: HTMLElement, h: string) { el.innerHTML = h; }\n', 'frontend/src/app/x.tsx', 'no-restricted-syntax', /innerHTML/);
    await assertErrors('export const h = (el: HTMLElement) => el.innerHTML;\n', 'frontend/src/app/x.tsx', 'no-restricted-syntax', /innerHTML/);
    await assertErrors('export const h = (el: HTMLElement) => el.outerHTML;\n', 'frontend/src/app/x.tsx', 'no-restricted-syntax', /outerHTML/);
    await assertErrors("export function f(el: HTMLElement, h: string) { el.insertAdjacentHTML('beforeend', h); }\n", 'frontend/src/app/x.tsx', 'no-restricted-syntax', /insertAdjacentHTML/);
    await assertClean('export const A = ({ t }: { t: string }) => <div>{t}</div>;\n', 'frontend/src/app/x.tsx');
  });

  test('PlayerView assertions are errors outside projection, session/fake.ts and tests (D-L10)', async () => {
    const asCast = 'declare const raw: unknown;\nexport const v = raw as PlayerView;\n';
    const angle = 'declare const raw: unknown;\nexport const v = <PlayerView>raw;\n';
    const doubleCast = 'declare const raw: object;\nexport const v = raw as unknown as PlayerView;\n';
    for (const filePath of ['frontend/src/session/x.ts', 'packages/engine/src/hand/x.ts', 'frontend/src/net/x.ts', 'frontend/src/ai/bot/x.ts']) {
      await assertErrors(asCast, filePath, 'no-restricted-syntax', /PlayerView/);
      await assertErrors(angle, filePath, 'no-restricted-syntax', /PlayerView/);
      await assertErrors(doubleCast, filePath, 'no-restricted-syntax', /PlayerView/);
    }
    await assertErrors(asCast, 'frontend/src/app/x.tsx', 'no-restricted-syntax', /PlayerView/);
    for (const filePath of ['packages/engine/src/projection/project.ts', 'frontend/src/session/fake.ts', 'frontend/src/session/x.test.ts', 'packages/engine/test/golden/x.ts']) {
      await assertClean(asCast, filePath);
      await assertClean(angle, filePath);
    }
    // other assertions are not affected
    await assertClean('declare const raw: unknown;\nexport const v = raw as string;\n', 'frontend/src/session/x.ts');
  });

  test('allow-listed files keep every other global ban (a REPLACE would silently drop them)', async () => {
    await assertErrors('export const r = Math.random();\n', 'packages/engine/src/projection/project.ts', 'no-restricted-properties');
    await assertErrors('declare const el: HTMLElement;\nexport const h = el.innerHTML;\n', 'frontend/src/session/fake.ts', 'no-restricted-syntax', /innerHTML/);
    await assertErrors('declare const a: Uint8Array;\nexport const x = crypto.getRandomValues(a);\n', 'frontend/src/session/fake.ts', 'no-restricted-syntax', /getRandomValues/);
    await assertErrors("export const k = 'cp.byok.v1.openai';\n", 'packages/engine/src/projection/project.ts', 'no-restricted-syntax', /cp\.byok/);
    await assertErrors('declare const raw: unknown;\nexport const v = raw as PlayerView;\n', 'frontend/src/host/crypto-rng.ts', 'no-restricted-syntax', /PlayerView/);
    await assertErrors('declare const raw: unknown;\nexport const v = raw as PlayerView;\n', 'frontend/src/ai/keys/key-store.ts', 'no-restricted-syntax', /PlayerView/);
    await assertErrors('declare const a: Uint8Array;\nexport const x = crypto.getRandomValues(a);\n', 'frontend/src/ai/keys/key-store.ts', 'no-restricted-syntax', /getRandomValues/);
    await assertErrors('declare const el: HTMLElement;\nexport const h = el.innerHTML;\n', 'frontend/src/session/x.test.ts', 'no-restricted-syntax', /innerHTML/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// C. no-console
// ---------------------------------------------------------------------------------------------------------------
describe('C. no-console in every module (T-004)', () => {
  const modules = [
    'packages/engine/src/x.ts',
    'packages/analysis/src/x.ts',
    'frontend/src/config/x.ts',
    'frontend/src/host/x.ts',
    'frontend/src/net/x.ts',
    'frontend/src/session/x.ts',
    'frontend/src/storage/x.ts',
    'frontend/src/share/x.ts',
    'frontend/src/ai/x.ts',
    'frontend/src/app/x.tsx',
  ];
  test('console.log/debug/info/warn/error are errors in product sources', async () => {
    for (const filePath of modules) {
      for (const method of ['log', 'debug', 'info', 'warn', 'error']) {
        await assertErrors(`export function f(x: unknown) { console.${method}(x); }\n`, filePath, 'no-console');
      }
    }
  });
  test('test files and scripts may use console', async () => {
    for (const filePath of ['frontend/src/session/x.test.ts', 'frontend/src/app/x.test.tsx', 'packages/engine/src/x.test.ts', 'packages/engine/test/golden/x.ts']) {
      await assertClean('export function f(x: unknown) { console.log(x); }\n', filePath);
    }
    await assertClean('export function f(x) { console.log(x); }\n', 'scripts/some-tool.mjs');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D. crypto.getRandomValues allow-list (S11-F11)
// ---------------------------------------------------------------------------------------------------------------
describe('D. crypto.getRandomValues', () => {
  const variants = [
    'declare const a: Uint8Array;\nexport const x = crypto.getRandomValues(a);\n',
    'declare const a: Uint8Array;\nexport const x = self.crypto.getRandomValues(a);\n',
    'declare const a: Uint8Array;\nexport const x = globalThis.crypto.getRandomValues(a);\n',
  ];
  test('allowed in the four files and in tests', async () => {
    for (const filePath of [
      'frontend/src/host/crypto-rng.ts',
      'frontend/src/storage/device.ts',
      'frontend/src/net/proof.ts',
      'frontend/src/ai/metrics/rng.ts',
      'frontend/src/session/x.test.ts',
      'packages/engine/test/x.ts',
    ]) {
      for (const code of variants) await assertClean(code, filePath);
    }
  });
  test('crypto., self.crypto. and globalThis.crypto. are errors anywhere else', async () => {
    for (const filePath of ['frontend/src/session/x.ts', 'frontend/src/host/other.ts', 'frontend/src/net/ice.ts', 'frontend/src/ai/bot/x.ts', 'packages/engine/src/util/rng.ts']) {
      for (const code of variants) await assertErrors(code, filePath, 'no-restricted-syntax', /getRandomValues/);
    }
  });
  test('crypto.subtle is outside the rule', async () => {
    await assertClean("declare const d: Uint8Array;\nexport const h = crypto.subtle.digest('SHA-256', d);\n", 'frontend/src/session/x.ts');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// E. cp.byok.* literals (ERD section 8)
// ---------------------------------------------------------------------------------------------------------------
describe('E. cp.byok literals', () => {
  const literal = "export const k = 'cp.byok.v1.openai';\n";
  const template = 'export const key = (p: string) => `cp.byok.v1.${p}`;\n';
  test('string and template literals are errors outside ai/keys', async () => {
    for (const filePath of ['frontend/src/net/x.ts', 'frontend/src/storage/wipe.ts', 'frontend/src/ai/providers/x.ts', 'frontend/src/app/x.tsx']) {
      await assertErrors(literal, filePath, 'no-restricted-syntax', /cp\.byok/);
      await assertErrors(template, filePath, 'no-restricted-syntax', /cp\.byok/);
    }
  });
  test('allowed in ai/keys and in tests', async () => {
    for (const filePath of ['frontend/src/ai/keys/key-store.ts', 'frontend/src/ai/keys/x.ts', 'frontend/src/storage/wipe.test.ts', 'frontend/src/ai/providers/x.test.ts']) {
      await assertClean(literal, filePath);
      await assertClean(template, filePath);
    }
  });
  test('other strings are fine', async () => {
    await assertClean("export const k = 'cp.lang.v1';\n", 'frontend/src/storage/x.ts');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// F. host-relay.ts (D29, T-001, Q2-003) — 15 violations + 2 allowed + the global bans must survive the override
// ---------------------------------------------------------------------------------------------------------------
describe('F. session/host-relay.ts', () => {
  const file = 'frontend/src/session/host-relay.ts';
  const violations = {
    'new TextDecoder()': ['export function relayOut(msg: { bytes: ArrayBuffer }) { return new TextDecoder().decode(msg.bytes); }\n', /decoders|relayed bytes/],
    'JSON.parse(x)': ['export function relayOut(x: string) { return JSON.parse(x); }\n', /JSON\.parse/],
    'JSON.stringify(x)': ['export function relayOut(x: unknown) { return JSON.stringify(x); }\n', /JSON\.stringify/],
    'atob(x)': ['export function relayOut(x: string) { return atob(x); }\n', /atob/],
    'new Uint8Array(b)': ['export function relayOut(b: ArrayBuffer) { return new Uint8Array(b); }\n', /typed-array/],
    'new DataView(b)': ['export function relayOut(b: ArrayBuffer) { return new DataView(b); }\n', /DataView|typed-array/],
    'b.slice(0)': ['export function relayOut(b: ArrayBuffer) { return b.slice(0); }\n', /copy relayed bytes/],
    'structuredClone(b)': ['export function relayOut(b: ArrayBuffer) { return structuredClone(b); }\n', /structuredClone/],
    'String.fromCharCode(1)': ['export function relayOut() { return String.fromCharCode(1); }\n', /fromCharCode/],
    'module-level let cache': ['let cache: ArrayBuffer | null = null;\nexport function relayOut() { return cache; }\n', /no module-level variables/],
    'module-level const q = [] + q.push(msg.bytes)': ['const q: ArrayBuffer[] = [];\nexport function relayOut(msg: { bytes: ArrayBuffer }) { q.push(msg.bytes); }\n', /accumulate/],
    'module-level const m = new Map() + m.set(id, msg.bytes)': ['const m = new Map<string, ArrayBuffer>();\nexport function relayOut(id: string, msg: { bytes: ArrayBuffer }) { m.set(id, msg.bytes); }\n', /accumulate/],
    "value import decodeEnvelope from '@checky/engine/protocol'": ["import { decodeEnvelope } from '@checky/engine/protocol';\nexport function relayOut(b: Uint8Array) { return decodeEnvelope(b); }\n", /protocol/],
    "import debugLog from '@/config'": ["import { debugLog } from '@/config';\nexport function relayOut() { debugLog('N-PAUSED'); }\n", /config/],
    'console.log(b)': ['export function relayOut(b: ArrayBuffer) { console.log(b); }\n', null],
  };

  for (const [name, [code, re]] of Object.entries(violations)) {
    test(`violation: ${name}`, async () => {
      const messages = await lint(code, file);
      assert.ok(messages.length > 0, `expected at least one error for: ${name}`);
      if (re !== null) assert.ok(messages.some((m) => re.test(m.message)), `expected a message matching ${re} for: ${name}; got ${JSON.stringify(messages.map((m) => m.message))}`);
      else assert.ok(has(messages, 'no-console'));
    });
  }
  test('there are exactly 15 violation samples', () => {
    assert.equal(Object.keys(violations).length, 15);
  });

  test('accumulating without a module-level declaration is still caught by the call selector alone', async () => {
    const push = await lint('export function relayOut(msg: { bytes: ArrayBuffer }) { const q: ArrayBuffer[] = []; q.push(msg.bytes); return q; }\n', file);
    assert.deepEqual(rulesOf(push), ['no-restricted-syntax']);
    assert.ok(/accumulate/.test(push[0].message));
    const set = await lint('export function relayOut(id: string, msg: { bytes: ArrayBuffer }) { const m = new Map<string, ArrayBuffer>(); m.set(id, msg.bytes); return m; }\n', file);
    assert.ok(set.some((m) => /accumulate/.test(m.message)));
  });

  test('allowed: a type-only protocol import, and relayOut as a single conn.send line', async () => {
    await assertClean("import type { Envelope } from '@checky/engine/protocol';\nexport type Relayed = Envelope;\n", file);
    await assertClean(
      'export function relayOut(msg: { to: string[]; bytes: ArrayBuffer }, conn: { send(bytes: ArrayBuffer, to: string[]): void }): void {\n  conn.send(msg.bytes, msg.to);\n}\n',
      file,
    );
  });

  test('RG1-L-01: the global bans stay active inside host-relay.ts (the override must not REPLACE them)', async () => {
    await assertErrors('export function relayOut() { return Math.random(); }\n', file, 'no-restricted-properties', /Math\.random/);
    await assertErrors('export function relayOut(raw: unknown) { return raw as PlayerView; }\n', file, 'no-restricted-syntax', /PlayerView/);
    await assertErrors('export function relayOut(raw: unknown) { return <PlayerView>raw; }\n', file, 'no-restricted-syntax', /PlayerView/);
    await assertErrors('export function relayOut(a: Uint8Array) { return crypto.getRandomValues(a); }\n', file, 'no-restricted-syntax', /getRandomValues/);
    await assertErrors("export function relayOut() { return 'cp.byok.v1.openai'; }\n", file, 'no-restricted-syntax', /cp\.byok/);
    await assertErrors('export function relayOut(p: string) { return `cp.byok.v1.${p}`; }\n', file, 'no-restricted-syntax', /cp\.byok/);
    await assertErrors('export function relayOut(el: HTMLElement) { return el.innerHTML; }\n', file, 'no-restricted-syntax', /innerHTML/);
    // and the session import boundary stays too
    await assertErrors("import { a } from '@/net/trystero';\nexport function relayOut() { return a; }\n", file, 'no-restricted-imports');
    await assertErrors("import { a } from '@/ai';\nexport function relayOut() { return a; }\n", file, 'no-restricted-imports');
  });

  // Lead review after T5.0 verification: bypasses the first rule set missed, plus a regression guard for the
  // `export const` selector (deleting it used to leave all 53 tests green).
  test('lead review: exported state, default exports, copies and global-object detours are errors', async () => {
    const cases = {
      'export const q = []': 'export const q: ArrayBuffer[] = [];\nexport function relayOut() { return q; }\n',
      'export let last': 'export let last: ArrayBuffer | null = null;\nexport function relayOut() { return last; }\n',
      'export class Cache': 'export class Cache { static q: ArrayBuffer[] = []; }\nexport function relayOut() { return Cache; }\n',
      'export default class': 'export default class Cache { q: ArrayBuffer[] = []; }\n',
      'export default new Map()': 'export default new Map<string, ArrayBuffer>();\n',
      'Uint8Array.from(b)': 'export function relayOut(b: ArrayBuffer) { return Uint8Array.from(new Uint8Array(0)); }\n',
      'Array.from(b)': 'export function relayOut(b: Iterable<number>) { return Array.from(b); }\n',
      '[...b]': 'export function relayOut(b: Iterable<number>) { return [...b]; }\n',
      'Buffer.from(b)': 'export function relayOut(b: ArrayBuffer) { return Buffer.from(b); }\n',
      'globalThis.atob(b)': 'export function relayOut(b: string) { return globalThis.atob(b); }\n',
      'window.atob(b)': 'export function relayOut(b: string) { return window.atob(b); }\n',
      'self.JSON.parse(b)': 'export function relayOut(b: string) { return self.JSON.parse(b); }\n',
      'localStorage.setItem': "export function relayOut(b: string) { localStorage.setItem('k', b); }\n",
      'indexedDB.open': "export function relayOut() { return indexedDB.open('x'); }\n",
    };
    for (const [name, code] of Object.entries(cases)) {
      const messages = await lint(code, file);
      assert.ok(messages.length > 0, `expected at least one error for: ${name}`);
    }
  });

  test('the relay rules do not leak into the rest of session', async () => {
    await assertClean("export const parsed = JSON.parse('{}') as unknown;\n", 'frontend/src/session/guest.ts');
    await assertClean('let cache = 0;\nexport function f() { return cache; }\n', 'frontend/src/session/host.ts');
    await assertClean("import { debugLog } from '@/config';\nexport function f() { debugLog('N-PAUSED'); }\n", 'frontend/src/session/host.ts');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// G. type-aware rules (T-003) — real config, real fixture files
// ---------------------------------------------------------------------------------------------------------------
describe('G. type-aware no-unsafe-* (T-003)', () => {
  async function lintFixture(name) {
    const filePath = `scripts/lint-fixtures/${name}`;
    const code = readFileSync(path.join(root, filePath), 'utf8');
    return lint(code, filePath, typeAware);
  }

  test('JSON.parse(raw).b.view assigned to a PlayerView is an error', async () => {
    const messages = await lintFixture('unsafe-json-to-view.ts');
    assert.ok(has(messages, '@typescript-eslint/no-unsafe-assignment'));
    assert.ok(has(messages, '@typescript-eslint/no-unsafe-member-access'));
  });
  test('MessageEvent.data (any) assigned to an Envelope is an error', async () => {
    assert.ok(has(await lintFixture('unsafe-message-event.ts'), '@typescript-eslint/no-unsafe-assignment'));
  });
  test('any into an argument and out of a function is an error', async () => {
    const messages = await lintFixture('unsafe-argument-return.ts');
    assert.ok(has(messages, '@typescript-eslint/no-unsafe-argument'));
    assert.ok(has(messages, '@typescript-eslint/no-unsafe-return'));
  });
  test('const x: unknown = JSON.parse(raw) is clean', async () => {
    assert.deepEqual((await lintFixture('safe-unknown.ts')).map((m) => m.ruleId), []);
  });

  // The fixtures prove the behaviour; this proves the rules are switched on for the right product paths.
  const isOn = (v) => (Array.isArray(v) ? v[0] : v) === 2 || (Array.isArray(v) ? v[0] : v) === 'error';
  const rules = ['no-unsafe-assignment', 'no-unsafe-argument', 'no-unsafe-return', 'no-unsafe-member-access'];
  test('enabled for engine, analysis, host, session, net, storage, share, ai sources', async () => {
    for (const filePath of [
      'packages/engine/src/x.ts',
      'packages/analysis/src/x.ts',
      'frontend/src/host/x.ts',
      'frontend/src/session/x.ts',
      'frontend/src/session/host-relay.ts',
      'frontend/src/net/x.ts',
      'frontend/src/storage/x.ts',
      'frontend/src/share/x.ts',
      'frontend/src/ai/x.ts',
    ]) {
      const config = await typeAware.calculateConfigForFile(path.join(root, filePath));
      for (const rule of rules) assert.ok(isOn(config.rules[`@typescript-eslint/${rule}`]), `${rule} should be an error for ${filePath}`);
    }
  });
  test('off for app, config, tests and tooling', async () => {
    for (const filePath of ['frontend/src/app/x.tsx', 'frontend/src/config/x.ts', 'frontend/src/session/x.test.ts', 'packages/engine/test/x.ts', 'packages/engine/src/x.test.ts']) {
      const config = await typeAware.calculateConfigForFile(path.join(root, filePath));
      for (const rule of rules) assert.ok(!isOn(config.rules[`@typescript-eslint/${rule}`]), `${rule} should be off for ${filePath}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// H. ignores and the current tree
// ---------------------------------------------------------------------------------------------------------------
describe('I. dynamic import()', () => {
  test('import() of another module, a deep alias path or a computed path is an error everywhere', async () => {
    await assertErrors("export const f = () => import('@/ai/keys/key-store');\n", 'frontend/src/app/home/x.tsx', 'no-restricted-syntax', /import\(\)/);
    await assertErrors("export const f = () => import('../ai/keys/key-store');\n", 'frontend/src/app/x.tsx', 'no-restricted-syntax', /import\(\)/);
    await assertErrors('export const f = (p: string) => import(p);\n', 'frontend/src/net/x.ts', 'no-restricted-syntax', /import\(\)/);
    await assertErrors("export const f = () => import('@checky/engine/table');\n", 'frontend/src/ai/x.ts', 'no-restricted-syntax', /import\(\)/);
  });
  test('same-folder lazy loads stay allowed (net runtime loader, app route screens)', async () => {
    await assertClean("export const load = () => import('./runtime');\n", 'frontend/src/net/index.ts');
    await assertClean("export const Screen = () => import('./screens/home');\n", 'frontend/src/app/routes.tsx');
  });
  test('allow-listed files keep the dynamic import ban', async () => {
    await assertErrors("export const f = () => import('@/net/trystero');\n", 'frontend/src/ai/keys/key-store.ts', 'no-restricted-syntax', /import\(\)/);
  });
});

describe('H. ignores', () => {
  test('legacy, dist, spikes and the lint fixtures are ignored by the default instance', async () => {
    const defaults = new ESLint({ cwd: root });
    for (const filePath of ['frontend/src/app/legacy/Lobby.tsx', 'frontend/dist/assets/x.js', 'spikes/00/x.js', 'scripts/lint-fixtures/unsafe-message-event.ts']) {
      assert.equal(await defaults.isPathIgnored(path.join(root, filePath)), true, filePath);
    }
    for (const filePath of ['frontend/src/app/App.tsx', 'frontend/src/config/index.ts', 'packages/engine/src/index.ts']) {
      assert.equal(await defaults.isPathIgnored(path.join(root, filePath)), false, filePath);
    }
  });
});

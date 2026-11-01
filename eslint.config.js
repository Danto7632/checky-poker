// Root ESLint config (flat). Lead-owned and frozen during W5 (build-plan section 1, ADR-0015).
//
// The module boundaries live HERE, not in people's heads: a rule that needs an exception is changed by the lead.
//
// Flat config rule options are REPLACED, not merged, when a later block sets the same rule for the same file.
// Every list of restricted syntax/properties/globals/imports is therefore built from the shared constants below,
// and an override (host-relay.ts, allow-listed files, tests) is built by concatenating or filtering those same
// constants. Never write a literal list inside an override (RG1-L-01).
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------------------------------------------
// File groups
// ---------------------------------------------------------------------------------------------------------------
const TS = '{ts,tsx}';
const PRODUCT_FILES = [`frontend/src/**/*.${TS}`, `packages/*/{src,test}/**/*.${TS}`];
const SRC_FILES = [`frontend/src/**/*.${TS}`, `packages/*/src/**/*.${TS}`];
const TEST_FILES = [`**/*.test.${TS}`, `packages/*/test/**/*.${TS}`];
// engine, analysis, host, session, net, storage, share, ai (not app, not config): type-aware no-unsafe-* (T-003).
// scripts/lint-fixtures holds the type-aware samples for scripts/lint-rules.test.mjs (ignored by `eslint .`).
const TYPE_AWARE_FILES = [
  'packages/engine/src/**/*.ts',
  'packages/analysis/src/**/*.ts',
  `frontend/src/{host,session,net,storage,share,ai}/**/*.${TS}`,
  'scripts/lint-fixtures/**/*.ts',
];
const HOST_RELAY_FILE = 'frontend/src/session/host-relay.ts';
const GET_RANDOM_VALUES_FILES = [
  'frontend/src/host/crypto-rng.ts',
  'frontend/src/storage/device.ts',
  'frontend/src/net/proof.ts',
  'frontend/src/ai/metrics/rng.ts',
];
const PLAYER_VIEW_ASSERTION_FILES = ['packages/engine/src/projection/**', 'frontend/src/session/fake.ts'];
const BYOK_LITERAL_FILES = ['frontend/src/ai/keys/**'];

// ---------------------------------------------------------------------------------------------------------------
// Global bans, as named entries so overrides can filter them by id
// ---------------------------------------------------------------------------------------------------------------
const SYNTAX_BANS = {
  dangerouslySetInnerHTML: {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is forbidden (ADR-0014: XSS first line of defence).',
  },
  innerHTML: {
    selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
    message: 'innerHTML/outerHTML are forbidden (ADR-0014). Build DOM with text nodes or React.',
  },
  insertAdjacentHTML: {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is forbidden (ADR-0014).',
  },
  playerViewAs: {
    selector: "TSAsExpression[typeAnnotation.typeName.name='PlayerView']",
    message: 'Do not assert PlayerView. Only projection (engine) and session/fake.ts may brand a view (ADR-0002, D-L10).',
  },
  playerViewAngle: {
    selector: "TSTypeAssertion[typeAnnotation.typeName.name='PlayerView']",
    message: 'Do not assert PlayerView. Only projection (engine) and session/fake.ts may brand a view (ADR-0002, D-L10).',
  },
  getRandomValues: {
    selector: "CallExpression[callee.property.name='getRandomValues']",
    message:
      'crypto.getRandomValues is allowed only in host/crypto-rng.ts, storage/device.ts, net/proof.ts and ai/metrics/rng.ts (code-structure section 5).',
  },
  byokLiteral: {
    selector: 'Literal[value=/^cp\\.byok\\./]',
    message: 'The cp.byok.* key literal belongs to ai/keys only (data-model-erd section 8).',
  },
  byokTemplate: {
    selector: 'TemplateElement[value.raw=/^cp\\.byok\\./]',
    message: 'The cp.byok.* key literal belongs to ai/keys only (data-model-erd section 8).',
  },
  // no-restricted-imports does not see import(). Only same-folder lazy loads ('./x') are allowed, so a dynamic
  // import cannot reach another module's internals or a computed path.
  // ponytail: './' still allows a relative climb inside the same folder tree only; if a cross-module lazy load is
  // ever needed, add an explicit allow entry here instead of widening the pattern.
  dynamicImport: {
    selector: 'ImportExpression:not([source.value=/^\\.\\//])',
    message: "import() may only load a same-folder file ('./x'). Use a static import for other modules (code-structure section 3).",
  },
};
const PLAYER_VIEW_IDS = ['playerViewAs', 'playerViewAngle'];
const BYOK_IDS = ['byokLiteral', 'byokTemplate'];
const GET_RANDOM_VALUES_IDS = ['getRandomValues'];

const GLOBAL_PROPERTIES = [
  { object: 'Math', property: 'random', message: 'Math.random is forbidden. Use the injected Rng (avatar flourish only, with an eslint-disable reason).' },
];
// No global-level restricted globals today. Kept so overrides concatenate instead of replacing.
const GLOBAL_GLOBALS = [];

/** Selector entries of every global ban except the given ids. */
function syntaxExcept(...ids) {
  const skip = new Set(ids.flat());
  return Object.entries(SYNTAX_BANS)
    .filter(([id]) => !skip.has(id))
    .map(([, ban]) => ban);
}
const GLOBAL_SYNTAX = syntaxExcept();

// ---------------------------------------------------------------------------------------------------------------
// host-relay.ts (D29): relays opaque bytes, interprets nothing (api-contracts section 6 host_main_relay)
// ---------------------------------------------------------------------------------------------------------------
// globalThis/window/self are banned as a whole so `globalThis.atob(b)` or `self.JSON.parse(b)` cannot sidestep the
// per-name bans; storage globals are banned because the relay must not keep bytes anywhere (D29 must_not: store).
const RELAY_GLOBALS = [
  'TextDecoder', 'atob', 'btoa', 'DataView', 'Blob', 'Response', 'FileReader', 'structuredClone',
  'globalThis', 'window', 'self', 'Buffer', 'localStorage', 'sessionStorage', 'indexedDB', 'caches',
].map((name) => ({
  name,
  message: 'host-relay.ts must not read, copy or decode relayed bytes (D29).',
}));
const RELAY_PROPERTIES = [
  { object: 'JSON', property: 'parse' },
  { object: 'JSON', property: 'stringify' },
  { object: 'String', property: 'fromCharCode' },
  { object: 'globalThis', property: 'structuredClone' },
].map((p) => ({ ...p, message: 'host-relay.ts must not read, copy or decode relayed bytes (D29).' }));
const RELAY_SYNTAX = [
  {
    selector:
      'NewExpression[callee.name=/^(Uint8Array|Int8Array|Uint16Array|Int16Array|Uint32Array|Int32Array|Float32Array|Float64Array|Uint8ClampedArray|DataView|TextDecoder)$/]',
    message: 'host-relay.ts must not create typed-array views or decoders over relayed bytes (D29).',
  },
  { selector: "CallExpression[callee.property.name='slice']", message: 'host-relay.ts must not copy relayed bytes (D29).' },
  {
    selector: 'Program > VariableDeclaration',
    message: 'host-relay.ts has no module-level variables of any kind: only imports and `export function relayOut` (D29).',
  },
  {
    selector: 'Program > ExportNamedDeclaration > VariableDeclaration',
    message: 'host-relay.ts has no module-level variables of any kind: only imports and `export function relayOut` (D29).',
  },
  { selector: 'Program > ClassDeclaration', message: 'host-relay.ts has no classes (D29).' },
  { selector: 'Program > ExportNamedDeclaration > ClassDeclaration', message: 'host-relay.ts has no classes (D29).' },
  {
    selector: 'Program > ExportDefaultDeclaration',
    message: 'host-relay.ts has no default export: only imports and `export function relayOut` (D29).',
  },
  {
    selector: "CallExpression[callee.property.name=/^(from|of)$/]",
    message: 'host-relay.ts must not copy relayed bytes (Uint8Array.from, Array.from, Buffer.from ...) (D29).',
  },
  { selector: 'SpreadElement', message: 'host-relay.ts must not copy relayed bytes by spreading them (D29).' },
  {
    selector: 'CallExpression[callee.property.name=/^(push|unshift|splice|set|add|concat)$/]',
    message: 'host-relay.ts must not accumulate bytes in arrays, Maps or Sets (D29).',
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Import boundaries (code-structure section 3, table A)
// ---------------------------------------------------------------------------------------------------------------
const V = 'value'; // value and type imports allowed
const T = 'type'; // only `import type`
const SELF = 'self'; // everything inside the module, including deep paths
const ENGINE_ENTRIES = ['', 'table', 'projection', 'record', 'protocol', 'util'];
const FRONTEND_MODULES = ['config', 'net', 'host', 'session', 'storage', 'share', 'ai', 'app'];
const engineAll = Object.fromEntries(ENGINE_ENTRIES.map((e) => [e, V]));

// A module is addressed by `@/<module>` (index) or `@/<module>/<file>` (deep); relative forms are matched by the
// `**/<module>` groups. Only the index is public ("other modules only through index.ts").
const POLICY = {
  engine: {
    files: [`packages/engine/{src,test}/**/*.${TS}`],
    tests: [`packages/engine/src/**/*.test.${TS}`, `packages/engine/test/**/*.${TS}`],
    engine: engineAll,
    analysis: undefined,
    modules: {},
  },
  analysis: {
    files: [`packages/analysis/{src,test}/**/*.${TS}`],
    tests: [`packages/analysis/src/**/*.test.${TS}`, `packages/analysis/test/**/*.${TS}`],
    engine: engineAll,
    analysis: V,
    modules: {},
  },
  config: {
    files: [`frontend/src/config/**/*.${TS}`],
    tests: [`frontend/src/config/**/*.test.${TS}`],
    engine: {},
    analysis: undefined,
    modules: { config: SELF },
  },
  host: {
    files: [`frontend/src/host/**/*.${TS}`],
    tests: [`frontend/src/host/**/*.test.${TS}`],
    engine: engineAll,
    analysis: V,
    modules: { config: V, host: SELF },
  },
  net: {
    files: [`frontend/src/net/**/*.${TS}`],
    tests: [`frontend/src/net/**/*.test.${TS}`],
    engine: { protocol: V, util: V },
    analysis: undefined,
    modules: { config: V, net: SELF },
  },
  session: {
    files: [`frontend/src/session/**/*.${TS}`],
    tests: [`frontend/src/session/**/*.test.${TS}`],
    engine: engineAll,
    analysis: undefined,
    modules: { config: V, net: V, host: V, storage: T, session: SELF },
  },
  storage: {
    files: [`frontend/src/storage/**/*.${TS}`],
    tests: [`frontend/src/storage/**/*.test.${TS}`],
    engine: { record: V, util: V },
    analysis: undefined,
    modules: { config: V, storage: SELF },
  },
  share: {
    files: [`frontend/src/share/**/*.${TS}`],
    tests: [`frontend/src/share/**/*.test.${TS}`],
    engine: { record: V, util: V },
    analysis: undefined,
    modules: { config: V, share: SELF },
  },
  ai: {
    files: [`frontend/src/ai/**/*.${TS}`],
    tests: [`frontend/src/ai/**/*.test.${TS}`],
    engine: { '': T, table: T, projection: T, record: T, protocol: T, util: V },
    analysis: V,
    modules: { config: V, ai: SELF },
  },
  app: {
    files: [`frontend/src/app/**/*.${TS}`, `frontend/src/main.tsx`],
    tests: [`frontend/src/app/**/*.test.${TS}`],
    engine: { protocol: V, record: V },
    analysis: T,
    modules: { config: V, session: V, storage: V, share: V, ai: V, app: SELF },
  },
};

// Test files may import these two entries that product code may not (Q-008, T-013), and the read-only engine
// test helpers by relative path (T-006, Q-006, Q-019; see the regexes in importRestrictions).
const TEST_ONLY_EXCEPTIONS = ['!@/host/testing', '!**/host/testing', '!@/net/loopback', '!**/net/loopback'];

// Folders inside a module that carry another module's name: relative-path patterns for that name are skipped there.
const RELATIVE_NAME_COLLISIONS = { app: ['share'] };

const engineName = (entry) => (entry === '' ? '@checky/engine' : `@checky/engine/${entry}`);

function importRestrictions(id, { test }) {
  const policy = POLICY[id];
  const paths = [];
  const patterns = [];
  const note = `Import boundary (code-structure section 3, table A): "${id}" may not import this.`;

  for (const entry of ENGINE_ENTRIES) {
    if (id === 'engine') break; // own package
    const level = policy.engine[entry];
    if (level === V) continue;
    paths.push({ name: engineName(entry), message: note, ...(level === T ? { allowTypeImports: true } : {}) });
  }
  if (id !== 'analysis' && policy.analysis !== V) {
    paths.push({ name: '@checky/analysis', message: note, ...(policy.analysis === T ? { allowTypeImports: true } : {}) });
  }

  for (const mod of FRONTEND_MODULES) {
    const level = policy.modules[mod];
    if (level === SELF) continue;
    // Relative forms are skipped where a folder inside the importing module shares the module's name
    // (app/share/ is a screen folder, not the share module); the alias form is always checked.
    const relative = !(RELATIVE_NAME_COLLISIONS[id] ?? []).includes(mod);
    // The index and the deep paths are separate patterns: a negated exception (`!@/host/testing`) cannot re-include
    // a file whose parent directory is excluded by the same group, and `**/<module>` would exclude the directory.
    if (level === undefined || level === T) {
      patterns.push({
        regex: relative ? `^(@/|(\\.{1,2}/)+)${mod}$` : `^@/${mod}$`,
        ...(level === T ? { allowTypeImports: true } : {}),
        message: note,
      });
    }
    patterns.push({
      group: [`@/${mod}/**`, ...(relative ? [`**/${mod}/**`] : []), ...(test ? TEST_ONLY_EXCEPTIONS : [])],
      message: level === undefined ? note : `Import boundary: other modules are imported through "@/${mod}" (index.ts) only.`,
    });
  }

  // Relative paths into packages/ (regex: a negated glob cannot re-include a child of an excluded directory).
  if (id === 'engine') {
    patterns.push({ group: ['@/**', '**/frontend/**', '@checky/analysis'], message: note });
  } else if (id === 'analysis') {
    patterns.push({ group: ['@/**', '**/frontend/**'], message: note });
    patterns.push({ regex: test ? '^(\\.{1,2}/)+(.*/)?engine/(src/|test/(?!helpers/))' : '^(\\.{1,2}/)+(.*/)?engine/(src|test)/', message: note });
  } else {
    patterns.push({
      regex: test ? '^(\\.{1,2}/)+(.*/)?packages/(?!engine/test/helpers/)' : '^(\\.{1,2}/)+(.*/)?packages/',
      message: 'Use @checky/engine and @checky/analysis, not relative paths into packages/.',
    });
  }
  patterns.push({
    group: ['**/legacy', '**/legacy/**'],
    message: 'frontend/src/app/legacy is dormant (ADR-0012): never import it. Copy pieces into new files instead.',
  });
  return { paths, patterns };
}

const importBlocks = Object.entries(POLICY).flatMap(([id, policy]) => [
  { files: policy.files, rules: { 'no-restricted-imports': ['error', importRestrictions(id, { test: false })] } },
  { files: policy.tests, rules: { 'no-restricted-imports': ['error', importRestrictions(id, { test: true })] } },
]);

// host-relay.ts: the session import rules plus the relay extras, concatenated (never replaced).
const sessionImports = importRestrictions('session', { test: false });
const relayImports = {
  paths: [
    ...sessionImports.paths,
    { name: '@checky/engine/protocol', allowTypeImports: true, message: 'host-relay.ts may only import types from @checky/engine/protocol (D29).' },
  ],
  patterns: [
    ...sessionImports.patterns,
    { group: ['@/config', '@/config/**', '**/config', '**/config/**'], message: 'host-relay.ts must not import @/config (no debugLog of relayed bytes, D29).' },
  ],
};

// ---------------------------------------------------------------------------------------------------------------
export default [
  {
    ignores: [
      'backend/**',
      'frontend/dist/**',
      'frontend/src/app/legacy/**',
      '**/node_modules/**',
      'spikes/**',
      'scripts/lint-fixtures/**',
      // Local-only workflow folders (not in the public repository).
      '.agent-team/**',
      '.claude/**',
      'assets/**',
      'modules/**',
      'docs/**',
    ],
  },

  { files: [`**/*.${TS}`], plugins: { '@typescript-eslint': tseslint.plugin }, languageOptions: { parser: tseslint.parser } },

  {
    files: [`frontend/src/**/*.${TS}`],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Global bans.
  {
    files: PRODUCT_FILES,
    rules: {
      'no-restricted-properties': ['error', ...GLOBAL_PROPERTIES],
      'no-restricted-syntax': ['error', ...GLOBAL_SYNTAX],
    },
  },
  { files: SRC_FILES, rules: { 'no-console': 'error' } },

  // Module boundaries.
  ...importBlocks,

  // Type-aware: `any` flows (JSON.parse, MessageEvent.data, Response.json) must not reach branded types (T-003).
  {
    files: TYPE_AWARE_FILES,
    ignores: TEST_FILES,
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
    },
  },

  // host-relay.ts: ALL global bans stay active; the relay lists are concatenated onto them.
  {
    files: [HOST_RELAY_FILE],
    rules: {
      'no-restricted-globals': ['error', ...GLOBAL_GLOBALS, ...RELAY_GLOBALS],
      'no-restricted-properties': ['error', ...GLOBAL_PROPERTIES, ...RELAY_PROPERTIES],
      'no-restricted-syntax': ['error', ...GLOBAL_SYNTAX, ...RELAY_SYNTAX],
      'no-restricted-imports': ['error', relayImports],
      'no-console': 'error',
    },
  },

  // Allow-listed files: the exempt ban is removed from the list, every other global ban stays.
  { files: PLAYER_VIEW_ASSERTION_FILES, rules: { 'no-restricted-syntax': ['error', ...syntaxExcept(PLAYER_VIEW_IDS)] } },
  { files: GET_RANDOM_VALUES_FILES, rules: { 'no-restricted-syntax': ['error', ...syntaxExcept(GET_RANDOM_VALUES_IDS)] } },
  { files: BYOK_LITERAL_FILES, rules: { 'no-restricted-syntax': ['error', ...syntaxExcept(BYOK_IDS)] } },

  // Tests: console, PlayerView fixtures, crypto and key literals are fine; Math.random and the HTML sinks are not.
  {
    files: TEST_FILES,
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': ['error', ...syntaxExcept(PLAYER_VIEW_IDS, GET_RANDOM_VALUES_IDS, BYOK_IDS)],
    },
  },

];

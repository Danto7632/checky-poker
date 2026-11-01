// Tooling test for scripts/extract-contract-codes.mjs (story 0-0 AC-10). Run with: node --test scripts/extract-contract-codes.test.mjs
// The contract documents live in the local-only .agent-team folder, so the tests that read them are skipped in CI.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractCodes, extractContractBlocks } from './extract-contract-codes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const API = path.join(repoRoot, '.agent-team/04-architecture/api-contracts.md');
const ERD = path.join(repoRoot, '.agent-team/04-architecture/data-model-erd.md');
const JSON_OUT = path.join(repoRoot, 'frontend/src/config/contract-codes.json');
const TS_OUT = path.join(repoRoot, 'frontend/src/config/contract-codes.ts');
const docsAvailable = existsSync(API) && existsSync(ERD);

describe('committed contract-codes files', () => {
  const codes = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  const ts = readFileSync(TS_OUT, 'utf8');

  test('contract_version 1.0.4, 67 errors with {id, owner, surface, retry}, 13 notices with {id, to, p, ss, us}', () => {
    assert.equal(codes.contract_version, '1.0.4');
    assert.equal(codes.errors.length, 67);
    assert.equal(codes.notices.length, 13);
    for (const e of codes.errors) assert.deepEqual(Object.keys(e), ['id', 'owner', 'surface', 'retry']);
    for (const n of codes.notices) assert.deepEqual(Object.keys(n), ['id', 'to', 'p', 'ss', 'us']);
  });
  test('ids ascending, unique, and shaped E-... / N-...', () => {
    for (const [list, re] of [[codes.errors, /^E-[A-Z0-9-]+$/], [codes.notices, /^N-[A-Z0-9-]+$/]]) {
      const ids = list.map((x) => x.id);
      assert.deepEqual(ids, [...ids].sort());
      assert.equal(new Set(ids).size, ids.length);
      for (const id of ids) assert.match(id, re);
    }
  });
  test('ts has the four exports required by T-004 and lists the same ids as the json', () => {
    assert.match(ts, /export const ERROR_CODES = \[/);
    assert.match(ts, /export const NOTICE_CODES = \[/);
    assert.match(ts, /\] as const;/);
    assert.match(ts, /export type ErrorCode = \(typeof ERROR_CODES\)\[number\];/);
    assert.match(ts, /export type NoticeCode = \(typeof NOTICE_CODES\)\[number\];/);
    assert.deepEqual([...ts.matchAll(/^ {2}'(E-[A-Z0-9-]+)',$/gm)].map((m) => m[1]), codes.errors.map((e) => e.id));
    assert.deepEqual([...ts.matchAll(/^ {2}'(N-[A-Z0-9-]+)',$/gm)].map((m) => m[1]), codes.notices.map((n) => n.id));
  });
});

describe('extraction from the contract documents', { skip: docsAvailable ? false : '.agent-team contract documents not available (CI)' }, () => {
  function runOnce() {
    const dir = mkdtempSync(path.join(tmpdir(), 'contract-codes-'));
    const outJson = path.join(dir, 'c.json');
    const outTs = path.join(dir, 'c.ts');
    const r = spawnSync(process.execPath, [path.join(here, 'extract-contract-codes.mjs'), API, ERD, '--out-json', outJson, '--out-ts', outTs], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return { json: readFileSync(outJson, 'utf8'), ts: readFileSync(outTs, 'utf8'), stdout: r.stdout };
  }

  test('two runs are byte-identical (json and ts) and equal the committed files', () => {
    const a = runOnce();
    const b = runOnce();
    assert.equal(a.json, b.json);
    assert.equal(a.ts, b.ts);
    assert.equal(a.json, readFileSync(JSON_OUT, 'utf8'));
    assert.equal(a.ts, readFileSync(TS_OUT, 'utf8'));
    assert.match(a.stdout, /30 blocks, 67 errors, 13 notices/);
  });

  test('id sets equal an independent line-based read of errors.v1 / notices.v1 (set difference 0)', () => {
    const text = readFileSync(API, 'utf8');
    const section = (name) => {
      const start = text.indexOf(`contract: ${name}`);
      assert.ok(start >= 0, name);
      return text.slice(start, text.indexOf('\n```', start));
    };
    const ids = (block, prefix) => [...block.matchAll(new RegExp(`\\{id: (${prefix}-[A-Z0-9-]+)`, 'g'))].map((m) => m[1]).sort();
    const codes = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
    assert.deepEqual(codes.errors.map((e) => e.id), ids(section('errors.v1'), 'E'));
    assert.deepEqual(codes.notices.map((n) => n.id), ids(section('notices.v1'), 'N'));
  });
});

describe('parser independence assertions (J-R1-10)', () => {
  const doc = (body, front = 'contract_version: "1.0.4"') => ({
    name: 'x.md',
    markdown: `---\n${front}\n---\n\n\`\`\`yaml\ncontract: errors.v1\ncodes:\n  - {id: E-A, owner: Andrew, surface: screen, retry: none}\n${body}\`\`\`\n\n\`\`\`yaml\ncontract: notices.v1\ncodes:\n  - {id: N-A, to: all, p: "{}", ss: SS1, us: US1}\n\`\`\`\n`,
  });

  test('a clean document extracts', () => {
    const r = extractCodes([doc('')]);
    assert.equal(r.errors.length, 1);
    assert.equal(r.notices.length, 1);
    assert.equal(r.contractVersion, '1.0.4');
  });
  test('only blocks whose first key is `contract:` are collected', () => {
    const md = '```yaml\nnot_a_contract: 1\n```\n```yaml\n# comment\ncontract: a.v1\n```\n';
    assert.equal(extractContractBlocks(md).blocks.length, 1);
  });
  test('an unquoted YAML 1.1 boolean key (on/no/yes/off) fails; the quoted key passes', () => {
    for (const key of ['on', 'no', 'yes', 'off']) {
      assert.throws(() => extractCodes([doc(`extra:\n  ${key}: 1\n`)]), /not a string in YAML 1\.1/, key);
      assert.doesNotThrow(() => extractCodes([doc(`extra:\n  "${key}": 1\n`)]), key);
    }
  });
  test('a numeric or date-like key fails', () => {
    assert.throws(() => extractCodes([doc('extra:\n  400: x\n')]), /(read as number|not a string in YAML 1\.1)/);
    assert.throws(() => extractCodes([doc('extra:\n  2026-10-31: x\n')]), /not a string in YAML 1\.1/);
    assert.doesNotThrow(() => extractCodes([doc('extra:\n  "400": x\n')]));
  });
  test('a plain date value fails (front matter included); the quoted date passes', () => {
    assert.throws(() => extractCodes([doc('extra:\n  when: 2026-10-31\n')]), /date-like value/);
    assert.throws(() => extractCodes([doc('', 'contract_version: "1.0.4"\ndate: 2026-10-31')]), /date-like value/);
    assert.doesNotThrow(() => extractCodes([doc('', 'contract_version: "1.0.4"\ndate: "2026-10-31"')]));
  });
  test('duplicate keys, duplicate ids and diverging contract versions fail', () => {
    assert.throws(() => extractCodes([doc('extra:\n  a: 1\n  a: 2\n')]), /parse error/);
    assert.throws(() => extractCodes([doc('  - {id: E-A, owner: P, surface: screen, retry: none}\n')]), /duplicate id/);
    assert.throws(() => extractCodes([doc(''), { ...doc('', 'contract_version: "1.0.5"'), name: 'y.md' }]), /duplicate contract block|differs/);
  });
  test('an entry with a missing field fails', () => {
    assert.throws(() => extractCodes([doc('  - {id: E-B, owner: Andrew, surface: screen}\n')]), /field `retry`/);
  });
});

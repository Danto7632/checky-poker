// Tooling test for scripts/check-owners.mjs (story 0-0 AC-9, AC-13). Run with: node --test scripts/check-owners.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkAttribution, checkFiles, findOverlaps, globMatches, globsOverlap, ownerOf } from './check-owners.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const owners = JSON.parse(readFileSync(path.join(here, 'owners.json'), 'utf8'));
const run = (...args) => spawnSync(process.execPath, [path.join(here, 'check-owners.mjs'), ...args], { cwd: repoRoot, encoding: 'utf8' });

describe('glob algebra', () => {
  test('two globs overlap only when one directory is a prefix of the other', () => {
    assert.equal(globsOverlap('frontend/src/net/**', 'frontend/src/net/**'), true);
    assert.equal(globsOverlap('frontend/src/**', 'frontend/src/net/**'), true);
    assert.equal(globsOverlap('frontend/src/net/**', 'frontend/src/network/**'), false);
    assert.equal(globsOverlap('frontend/src/net/**', 'frontend/src/net/index.ts'), true);
    assert.equal(globsOverlap('frontend/src/net/**', 'frontend/src/network.ts'), false);
    assert.equal(globsOverlap('package.json', 'package.json'), true);
    assert.equal(globsOverlap('package.json', 'frontend/package.json'), false);
  });
  test('matching a file', () => {
    assert.equal(globMatches('frontend/src/net/**', 'frontend/src/net/a/b.ts'), true);
    assert.equal(globMatches('frontend/src/net/**', 'frontend/src/net'), false);
    assert.equal(globMatches('frontend/src/main.tsx', 'frontend/src/main.tsx'), true);
  });
  test('unsupported glob syntax is rejected instead of silently mis-matched', () => {
    assert.throws(() => globsOverlap('frontend/src/*.ts', 'frontend/src/a.ts'));
  });
});

describe('committed ownership tables', () => {
  test('0 overlapping glob pairs', () => {
    assert.deepEqual(findOverlaps(owners), []);
  });

  test('tracked files + planned files: each has exactly one owner (or frozen)', () => {
    const tracked = spawnSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
    const planned = readFileSync(path.join(here, 'planned-files.txt'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const { problems } = checkFiles(owners, [...new Set([...tracked, ...planned])]);
    assert.deepEqual(problems, []);
  });

  test('S11-F14 skeleton files are inside Phillip globs', () => {
    for (const f of [
      'packages/engine/src/table/index.ts',
      'packages/engine/src/projection/index.ts',
      'packages/engine/src/record/index.ts',
      'packages/engine/src/protocol/index.ts',
      'packages/engine/src/util/index.ts',
      'packages/engine/src/util/checky-error.ts',
      'frontend/src/host/testing.ts',
    ]) {
      assert.equal(ownerOf(owners, f).owner, 'Phillip', f);
    }
  });

  test('impl-notes: the individual owner wins over the frozen .agent-team/**', () => {
    assert.equal(ownerOf(owners, '.agent-team/08-impl-notes/backend.md').owner, 'Phillip');
    assert.equal(ownerOf(owners, '.agent-team/08-impl-notes/ml.md').owner, 'Stephen');
    assert.equal(ownerOf(owners, '.agent-team/08-impl-notes/frontend.md').owner, 'Andrew');
    assert.equal(ownerOf(owners, '.agent-team/04-architecture/api-contracts.md').owner, 'frozen');
  });

  test('AF-12 / D-L14: .env.example, ATTRIBUTIONS.md and README.md are Andrew-only and not frozen', () => {
    for (const f of ['frontend/.env.example', 'frontend/ATTRIBUTIONS.md', 'frontend/README.md']) {
      assert.equal(ownerOf(owners, f).owner, 'Andrew', f);
      assert.equal(owners.frozen.some((g) => globMatches(g, f)), false, f);
    }
    assert.equal(ownerOf(owners, 'README.md').owner, 'frozen');
    assert.equal(ownerOf(owners, 'package-lock.json').owner, 'Andrew');
    assert.equal(ownerOf(owners, 'frontend/package.json').owner, 'Andrew');
    assert.equal(ownerOf(owners, 'packages/engine/package.json').owner, 'lead');
  });

  test('BATHOS_OWNED_PATHS strings equal build-plan section 2.2 (skipped when .agent-team is not available)', (t) => {
    const plan = path.join(repoRoot, '.agent-team/04-architecture/build-plan.md');
    if (!existsSync(plan)) return t.skip('.agent-team/04-architecture/build-plan.md not available (CI)');
    const text = readFileSync(plan, 'utf8');
    for (const role of ['Phillip', 'Stephen', 'Andrew']) {
      const line = text.split('\n').find((l) => l.startsWith(`${role}:`));
      assert.ok(line, `${role} line not found in build-plan 2.2`);
      const expected = line.slice(line.indexOf(':') + 1).trim();
      const printed = run('--owned-paths', role).stdout.trim();
      assert.equal(printed, expected, role);
    }
  });
});

describe('detection', () => {
  test('an overlapping pair, a multiply-owned file and an unowned file are all reported', () => {
    const broken = structuredClone(owners);
    broken.Stephen.push('frontend/src/host/**');
    assert.ok(findOverlaps(broken).length >= 1);
    assert.ok(checkFiles(broken, ['frontend/src/host/shell.ts']).problems[0].startsWith('multiple owners'));
    assert.ok(checkFiles(owners, ['somewhere/else.txt']).problems[0].startsWith('unowned'));
  });

  test('--self-test exits non-zero and says both injected defects were detected', () => {
    const r = run('--self-test');
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /both detected/);
    assert.match(r.stderr, /glob overlap/);
    assert.match(r.stderr, /unowned: unowned-zone\/injected-file\.txt/);
  });

  test('the normal run exits 0 on the committed tree and prints per-owner counts', () => {
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /owners: Phillip \d+ \| Stephen \d+ \| Andrew \d+ \| lead \d+ \| frozen \d+/);
  });
});

describe('commit attribution (D-L9, BATHOS-Role trailer)', () => {
  const commit = (trailer, files) => ({ sha: 'a'.repeat(40), trailer, files });
  test('a role may change its own paths; Paul may change lead and frozen paths', () => {
    assert.deepEqual(checkAttribution(owners, [commit('Phillip', ['frontend/src/net/a.ts', 'packages/engine/src/x.ts'])]), []);
    assert.deepEqual(checkAttribution(owners, [commit('Andrew', ['package-lock.json', 'frontend/src/app/App.tsx'])]), []);
    assert.deepEqual(checkAttribution(owners, [commit('Paul', ['eslint.config.js', '.agent-team/04-architecture/build-plan.md'])]), []);
  });
  test('a missing trailer, another role\'s path, a frozen path or a lead path is a failure', () => {
    assert.equal(checkAttribution(owners, [commit('', ['frontend/src/net/a.ts'])]).length, 1);
    assert.equal(checkAttribution(owners, [commit('Stephen', ['frontend/src/net/a.ts'])]).length, 1);
    assert.equal(checkAttribution(owners, [commit('Phillip', ['docs/x.md'])]).length, 1);
    assert.equal(checkAttribution(owners, [commit('Andrew', ['eslint.config.js'])]).length, 1);
    assert.equal(checkAttribution(owners, [commit('Andrew', ['frontend/src/app/legacy/Lobby.tsx'])]).length, 0);
  });
});

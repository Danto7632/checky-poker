#!/usr/bin/env node
// Ownership checker (build-plan section 2.3, story 0-0 AC-9). Lead-owned.
//
//   node scripts/check-owners.mjs                      glob overlap + file ownership (tracked + planned files)
//   node scripts/check-owners.mjs --self-test          injects 1 overlapping glob pair and 1 unowned file; must exit non-zero
//   node scripts/check-owners.mjs --attribution A..B   every commit in the range carries `BATHOS-Role:` and only touches that role's paths
//   node scripts/check-owners.mjs --owned-paths Role   prints the BATHOS_OWNED_PATHS injection string (colon separated) for Phillip|Stephen|Andrew
//
// Globs are either `dir/**` or an exact file. Two globs overlap only if one directory is a prefix of the other.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const ROLES = ['Phillip', 'Stephen', 'Andrew', 'lead', 'frozen'];
const TRAILER_ROLE = { Phillip: 'Phillip', Stephen: 'Stephen', Andrew: 'Andrew', Paul: 'lead' };

function parseGlob(glob) {
  if (glob.endsWith('/**')) return { dir: true, base: glob.slice(0, -3) };
  if (glob.includes('*')) throw new Error(`unsupported glob (only "dir/**" or an exact file): ${glob}`);
  return { dir: false, base: glob };
}

export function globsOverlap(a, b) {
  const x = parseGlob(a);
  const y = parseGlob(b);
  if (!x.dir && !y.dir) return x.base === y.base;
  if (x.dir && !y.dir) return y.base.startsWith(`${x.base}/`);
  if (!x.dir && y.dir) return x.base.startsWith(`${y.base}/`);
  return x.base === y.base || x.base.startsWith(`${y.base}/`) || y.base.startsWith(`${x.base}/`);
}

export function globMatches(glob, file) {
  const g = parseGlob(glob);
  return g.dir ? file.startsWith(`${g.base}/`) : file === g.base;
}

function exempt(owners, a, b) {
  return (owners.allowOverlap ?? []).some(([p, q]) => (p === a && q === b) || (p === b && q === a));
}

/** @returns {string[]} one message per overlapping glob pair between different roles */
export function findOverlaps(owners) {
  const problems = [];
  for (let i = 0; i < ROLES.length; i++) {
    for (let j = i + 1; j < ROLES.length; j++) {
      for (const a of owners[ROLES[i]] ?? []) {
        for (const b of owners[ROLES[j]] ?? []) {
          if (globsOverlap(a, b) && !exempt(owners, a, b)) problems.push(`glob overlap: ${ROLES[i]} \`${a}\` x ${ROLES[j]} \`${b}\``);
        }
      }
    }
  }
  return problems;
}

/**
 * Resolves the single owner of a file.
 * @returns {{owner: string|null, matches: {role: string, glob: string}[]}} owner is null when unowned or ambiguous
 */
export function ownerOf(owners, file) {
  let matches = [];
  for (const role of ROLES) {
    for (const glob of owners[role] ?? []) if (globMatches(glob, file)) matches.push({ role, glob });
  }
  // `.agent-team/**` (frozen) contains the three impl-notes files owned by individuals: the specific owner wins.
  matches = matches.filter((m) => !matches.some((o) => exempt(owners, m.glob, o.glob) && isMoreSpecific(o.glob, m.glob)));
  const roles = [...new Set(matches.map((m) => m.role))];
  return { owner: roles.length === 1 ? roles[0] : null, matches };
}

function isMoreSpecific(a, b) {
  return !parseGlob(a).dir && parseGlob(b).dir;
}

export function checkFiles(owners, files) {
  const problems = [];
  const counts = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const file of files) {
    const { owner, matches } = ownerOf(owners, file);
    if (owner === null) {
      problems.push(
        matches.length === 0
          ? `unowned: ${file}`
          : `multiple owners: ${file} -> ${matches.map((m) => `${m.role}(${m.glob})`).join(', ')}`,
      );
    } else counts[owner]++;
  }
  return { problems, counts };
}

function readLines(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function loadInputs() {
  const owners = JSON.parse(readFileSync(path.join(here, 'owners.json'), 'utf8'));
  const tracked = git('ls-files').split('\n').filter(Boolean);
  const planned = readLines(path.join(here, 'planned-files.txt'));
  return { owners, tracked, planned, files: [...new Set([...tracked, ...planned])].sort() };
}

function report(label, problems, counts, fileCount) {
  for (const p of problems) console.error(`  ${p}`);
  const summary = ROLES.map((r) => `${r} ${counts[r]}`).join(' | ');
  console.log(`${label}: ${fileCount} files, ${problems.length} problem(s)`);
  console.log(`  owners: ${summary}`);
}

function runCheck({ selfTest }) {
  const input = loadInputs();
  let { owners, files } = input;
  if (selfTest) {
    // In-memory defects: Stephen also claims frontend/src/net/** (Phillip's), and a file nobody owns.
    owners = structuredClone(owners);
    owners.Stephen.push('frontend/src/net/**');
    files = [...files, 'unowned-zone/injected-file.txt'];
  }
  const overlaps = findOverlaps(owners);
  const { problems, counts } = checkFiles(owners, files);
  const all = [...overlaps, ...problems];
  report(selfTest ? 'check-owners --self-test (defects injected)' : 'check-owners', all, counts, files.length);
  if (selfTest) {
    const found = overlaps.length >= 1 && problems.some((p) => p.startsWith('unowned:'));
    console.log(found ? 'self-test: injected overlap and unowned file were both detected (non-zero exit is the expected result)' : 'self-test: BROKEN, an injected defect was not detected');
    process.exit(found ? 1 : 0);
  }
  if (all.length > 0) process.exit(1);
  console.log('check-owners: OK (0 overlapping glob pairs, 0 unowned, 0 multiply-owned)');
}

export function checkAttribution(owners, commits) {
  const problems = [];
  for (const { sha, trailer, files } of commits) {
    const role = TRAILER_ROLE[trailer];
    if (role === undefined) {
      problems.push(`${sha.slice(0, 7)}: missing or unknown BATHOS-Role trailer (${JSON.stringify(trailer)})`);
      continue;
    }
    for (const file of files) {
      const { owner } = ownerOf(owners, file);
      const allowed = owner === role || (role === 'lead' && owner === 'frozen');
      if (!allowed) problems.push(`${sha.slice(0, 7)}: BATHOS-Role ${trailer} may not change ${file} (owner: ${owner ?? 'none'})`);
    }
  }
  return problems;
}

function runAttribution(range) {
  const { owners } = loadInputs();
  const shas = git('log', '--no-merges', '--format=%H', range).split('\n').filter(Boolean);
  const commits = shas.map((sha) => ({
    sha,
    trailer: git('log', '-1', '--format=%(trailers:key=BATHOS-Role,valueonly)', sha).trim(),
    files: git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha).split('\n').filter(Boolean),
  }));
  const problems = checkAttribution(owners, commits);
  for (const p of problems) console.error(`  ${p}`);
  console.log(`check-owners --attribution ${range}: ${commits.length} commit(s), ${problems.length} problem(s)`);
  if (problems.length > 0) process.exit(1);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--self-test')) runCheck({ selfTest: true });
    else if (args[0] === '--owned-paths') {
      const role = args[1];
      if (!['Phillip', 'Stephen', 'Andrew'].includes(role)) throw new Error('usage: --owned-paths Phillip|Stephen|Andrew');
      console.log(loadInputs().owners[role].join(':'));
    } else if (args[0] === '--attribution') {
      if (args[1] === undefined) throw new Error('usage: --attribution <rev-range>');
      runAttribution(args[1]);
    } else runCheck({ selfTest: false });
  } catch (e) {
    console.error(`check-owners: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

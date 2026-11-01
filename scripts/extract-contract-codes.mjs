#!/usr/bin/env node
// Extracts the error/notice code tables from the contract documents into files that live inside the repo
// (the contract documents themselves are not part of the public repository, so CI cannot read them).
//
// Usage:
//   node scripts/extract-contract-codes.mjs <api-contracts.md> <data-model-erd.md> \
//        --out-json frontend/src/config/contract-codes.json --out-ts frontend/src/config/contract-codes.ts
//
// Rules (story 0-0 section E):
//   - Collect every ```yaml block whose first key is `contract:`.
//   - Parse with a YAML 1.2 parser, then assert the result is parser-independent: no mapping key that a
//     YAML 1.1 parser would read as boolean/null/number/timestamp, and no plain date-like value.
//   - errors.v1.codes[] -> {id, owner, surface, retry}; notices.v1.codes[] -> {id, to, p, ss, us}; sorted by id.
//   - Output is deterministic (no timestamps, no absolute paths).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isMap, isPair, isScalar, isSeq, parseDocument, visit } from 'yaml';

const ERROR_FIELDS = ['id', 'owner', 'surface', 'retry'];
const NOTICE_FIELDS = ['id', 'to', 'p', 'ss', 'us'];

// Plain (unquoted) scalars a YAML 1.1 parser would NOT read as a string.
// (single letters y/n are booleans only in the YAML 1.1 spec text; PyYAML, Psych and ruamel keep them as strings)
const YAML11_BOOL = /^(yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const YAML11_NULL = /^(~|null|Null|NULL)?$/;
const YAML11_NUMBER =
  /^[-+]?(0b[0-1_]+|0[0-7_]+|0x[0-9a-fA-F_]+|(0|[1-9][0-9_,]*)|[0-9][0-9_]*(:[0-5]?[0-9])+|([0-9][0-9_]*)?\.[0-9_]*([eE][-+]?[0-9]+)?|\.(inf|Inf|INF))$|^\.(nan|NaN|NAN)$/;
const YAML11_TIMESTAMP = /^\d{4}-\d{1,2}-\d{1,2}([Tt]|\s+)?(\d{1,2}:\d{2}:\d{2}(\.\d*)?)?\s*(Z|[-+]\d{1,2}(:?\d{2})?)?$/;

export function extractContractBlocks(markdown) {
  const lines = markdown.split('\n');
  let frontMatter = null;
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      frontMatter = { text: lines.slice(1, end).join('\n'), line: 2 };
      start = end + 1;
    }
  }
  const blocks = [];
  for (let i = start; i < lines.length; i++) {
    if (!/^```yaml\s*$/.test(lines[i] ?? '')) continue;
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j] ?? '')) j++;
    const text = lines.slice(i + 1, j).join('\n');
    const firstKey = text.split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (firstKey !== undefined && /^contract:/.test(firstKey)) blocks.push({ text, line: i + 2 });
    i = j;
  }
  return { frontMatter, blocks };
}

function describePath(path) {
  return path
    .map((n) => (isPair(n) && isScalar(n.key) ? String(n.key.value) : null))
    .filter((x) => x !== null)
    .join('.');
}

// Throws unless every mapping key is a string that stays a string in YAML 1.1, and no plain value looks like a date.
export function assertParserIndependent(doc, label) {
  const problems = [];
  visit(doc, {
    Pair(_, pair, path) {
      if (!isScalar(pair.key)) {
        problems.push(`${label}: non-scalar mapping key at ${describePath(path)}`);
        return;
      }
      if (typeof pair.key.value !== 'string') {
        problems.push(`${label}: key ${JSON.stringify(pair.key.value)} read as ${typeof pair.key.value} at ${describePath(path)}`);
        return;
      }
      if (pair.key.type === 'PLAIN' || pair.key.type === undefined) {
        const text = pair.key.source ?? pair.key.value;
        if (YAML11_BOOL.test(text) || YAML11_NULL.test(text) || YAML11_NUMBER.test(text) || YAML11_TIMESTAMP.test(text)) {
          problems.push(`${label}: plain key \`${text}\` is not a string in YAML 1.1 (quote it) at ${describePath(path)}`);
        }
      }
    },
    Scalar(key, node, path) {
      if (key === 'key') return;
      if ((node.type === 'PLAIN' || node.type === undefined) && typeof node.source === 'string' && YAML11_TIMESTAMP.test(node.source)) {
        problems.push(`${label}: plain date-like value \`${node.source}\` (quote it) at ${describePath(path)}`);
      }
    },
  });
  if (problems.length > 0) throw new Error(problems.join('\n'));
}

function parseStrict(text, label) {
  const doc = parseDocument(text, { version: '1.2', uniqueKeys: true });
  if (doc.errors.length > 0) {
    throw new Error(`${label}: YAML parse error: ${doc.errors.map((e) => e.message).join('; ')}`);
  }
  assertParserIndependent(doc, label);
  return doc;
}

function pickFields(entry, fields, label) {
  const out = {};
  for (const f of fields) {
    const v = entry?.[f];
    if (typeof v !== 'string' || v === '') throw new Error(`${label}: field \`${f}\` must be a non-empty string`);
    out[f] = v;
  }
  return out;
}

function compareId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function extractCodes(files) {
  const versions = [];
  const contracts = new Map();
  for (const { name, markdown } of files) {
    const { frontMatter, blocks } = extractContractBlocks(markdown);
    if (frontMatter === null) throw new Error(`${name}: front matter not found`);
    const fm = parseStrict(frontMatter.text, `${name} front matter`).toJS();
    if (typeof fm.contract_version !== 'string') throw new Error(`${name}: front matter contract_version missing`);
    versions.push(fm.contract_version);
    for (const b of blocks) {
      const label = `${name}:${b.line}`;
      const js = parseStrict(b.text, label).toJS();
      if (typeof js.contract !== 'string') throw new Error(`${label}: contract id missing`);
      if (contracts.has(js.contract)) throw new Error(`${label}: duplicate contract block ${js.contract}`);
      contracts.set(js.contract, js);
    }
  }
  if (new Set(versions).size !== 1) throw new Error(`contract_version differs between documents: ${versions.join(', ')}`);

  const need = (id) => {
    const block = contracts.get(id);
    if (block === undefined || !Array.isArray(block.codes)) throw new Error(`contract block ${id} with codes[] not found`);
    return block.codes;
  };
  const errors = need('errors.v1').map((e, i) => pickFields(e, ERROR_FIELDS, `errors.v1.codes[${i}]`)).sort(compareId);
  const notices = need('notices.v1').map((e, i) => pickFields(e, NOTICE_FIELDS, `notices.v1.codes[${i}]`)).sort(compareId);
  for (const [name, list] of [['errors.v1', errors], ['notices.v1', notices]]) {
    if (new Set(list.map((e) => e.id)).size !== list.length) throw new Error(`${name}: duplicate id`);
  }
  return { contractVersion: versions[0], blockCount: contracts.size, errors, notices };
}

export function renderJson({ contractVersion, errors, notices }) {
  return `${JSON.stringify({ contract_version: contractVersion, errors, notices }, null, 2)}\n`;
}

export function renderTs({ contractVersion, errors, notices }) {
  const list = (name, items) => `export const ${name} = [\n${items.map((e) => `  '${e.id}',`).join('\n')}\n] as const;\n`;
  return [
    `// Generated by scripts/extract-contract-codes.mjs from contract ${contractVersion}. Do not edit by hand.`,
    '// Source of the DebugCode literal union (api.config.v1) and of the i18n contract tests.',
    '',
    list('ERROR_CODES', errors),
    list('NOTICE_CODES', notices),
    'export type ErrorCode = (typeof ERROR_CODES)[number];',
    'export type NoticeCode = (typeof NOTICE_CODES)[number];',
    '',
  ].join('\n');
}

function main(argv) {
  const inputs = [];
  let outJson = null;
  let outTs = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-json') outJson = argv[++i] ?? null;
    else if (a === '--out-ts') outTs = argv[++i] ?? null;
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else inputs.push(a);
  }
  if (inputs.length === 0 || outJson === null || outTs === null) {
    throw new Error('usage: extract-contract-codes.mjs <md>... --out-json <file> --out-ts <file>');
  }
  const files = inputs.map((p) => ({ name: p.split('/').pop(), markdown: readFileSync(p, 'utf8') }));
  const result = extractCodes(files);
  for (const [path, content] of [[outJson, renderJson(result)], [outTs, renderTs(result)]]) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
    writeFileSync(path, content);
  }
  console.log(
    `contract ${result.contractVersion}: ${result.blockCount} blocks, ${result.errors.length} errors, ${result.notices.length} notices`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(`extract-contract-codes: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

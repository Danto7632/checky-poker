// The metrics Worker (frontend/src/ai/metrics/metrics.worker.ts) checks incoming views against hand copies of
// three engine values: the card pattern, STREETS and ACTION_TYPES. ai may only type-import
// @checky/engine/protocol, so the copies cannot import the originals; if one drifts (say the engine adds an action
// type), every view carrying it becomes ok:false and LiveOdds fails for good. This test pins them to the engine
// (lead review R0 3.2 m3).
//
// analysis may not import frontend code either (eslint boundary), so the Worker file is read as text through
// Vite's static glob (`?raw`) and the three declarations are pulled out by name. A declaration that is renamed or
// reshaped fails the extraction loudly instead of passing.
import { isCard } from '@checky/engine';
import { ACTION_TYPES, STREETS } from '@checky/engine/protocol';
import { describe, expect, it } from 'vitest';

type RawGlob = (pattern: string, opts: { eager: true; query: '?raw'; import: 'default' }) => Record<string, string>;
const WORKER = '../../../frontend/src/ai/metrics/metrics.worker.ts';
const source = (import.meta as unknown as { glob: RawGlob }).glob('../../../frontend/src/ai/metrics/metrics.worker.ts', {
  eager: true,
  query: '?raw',
  import: 'default',
})[WORKER];

function stringList(name: string): string[] {
  const m = new RegExp(`const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\];`).exec(source ?? '');
  if (m === null) throw new Error(`worker-copies: no "const ${name}: readonly string[] = [...]" in ${WORKER}`);
  return [...m[1]!.matchAll(/'([^']*)'/g)].map((x) => x[1]!);
}

function cardPattern(): RegExp {
  const m = /const CARD_RE = \/(.+)\/;/.exec(source ?? '');
  if (m === null) throw new Error(`worker-copies: no "const CARD_RE = /.../;" in ${WORKER}`);
  return new RegExp(m[1]!);
}

describe('metrics Worker copies of engine values', () => {
  it('finds the Worker source', () => {
    expect(typeof source).toBe('string');
  });

  it('STREETS and ACTION_TYPES equal the engine lists (order included)', () => {
    expect(stringList('STREETS')).toEqual([...STREETS]);
    expect(stringList('ACTION_TYPES')).toEqual([...ACTION_TYPES]);
  });

  it('the card pattern accepts exactly what the engine isCard accepts', () => {
    const re = cardPattern();
    // Every printable-ASCII string of length 1..3 over the characters that matter, plus all 2-char ASCII pairs.
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    const near = [...'23456789TJQKAshdcSHDCtjqka01X '];
    const samples = [...printable, ...printable.flatMap((a) => printable.map((b) => a + b)), ...near.flatMap((a) => near.map((b) => `${a}${b}s`))];
    const mismatches = samples.filter((s) => re.test(s) !== isCard(s));
    expect(mismatches).toEqual([]);
    expect(samples.filter((s) => isCard(s))).toHaveLength(52);
  });
});

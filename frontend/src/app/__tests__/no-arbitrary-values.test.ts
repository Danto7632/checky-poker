// Token compliance (design-handoff section 9, AC-11): no arbitrary colour, numeric, shadow or radius classes and no
// hex colours in app sources (legacy and the unused shadcn kit excluded). Values come from tokens.css via theme.css.
import { describe, expect, it } from 'vitest';
import { readRepoFile } from '../testing/node-fs';

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../legacy/**', '!../components/**', '!../__tests__/**', '!../**/*.test.{ts,tsx}'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
// CSS is read from disk: Vitest blanks CSS imports even with ?raw (see testing/node-fs.ts).
const styles = Object.fromEntries(
  ['fonts.css', 'tailwind.css', 'theme.css', 'index.css', 'landing.css'].map((f) => [`styles/${f}`, readRepoFile(`frontend/src/styles/${f}`)]),
);

const BANNED: [string, RegExp][] = [
  ['arbitrary colour -[#', /-\[#/],
  ['arbitrary number -[0-9', /-\[\d/],
  ['arbitrary shadow', /shadow-\[/],
  ['arbitrary radius', /rounded-\[/],
  ['url() in a class', /-\[url\(/],
  ['hex colour literal', /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b(?![-\w])/],
];

describe('no arbitrary values', () => {
  const all = { ...sources, ...styles };

  it('scans the app sources and styles', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(40);
    expect(Object.values(styles).every((css) => css.length > 0)).toBe(true);
  });

  it.each(BANNED)('%s: 0 occurrences', (_, re) => {
    const hits = Object.entries(all).flatMap(([f, src]) =>
      src
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        .filter(({ line }) => re.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*')),
    );
    expect(hits.map((h) => `${h.f}:${h.i}: ${h.line.trim()}`)).toEqual([]);
  });
});

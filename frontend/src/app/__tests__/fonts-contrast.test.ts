// W2-R3 automatic acceptance (Q-012). Reads sources and installed packages only (never dist).
// 1 Glyph coverage: every code point of the en/ja dictionaries is inside the unicode-range union of the fonts that
//   styles/fonts.css imports (Latin display font checked against Latin text only). Missing points are printed.
// 2 Contrast: WCAG 2.x relative-luminance ratios from tokens.css hex values for the accessibility.md section 1 pairs
//   (text >= 4.5, large text / UI >= 3); soft badge backgrounds are composited over --ink-850 first.
// 3 Variable axes: token font weights sit inside each family's @font-face weight range; Bricolage stretch range is
//   present. opsz is not declared in package CSS -> [unverified], checked in a real browser in W6.
import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ja } from '../i18n/ja';
import { readRepoFile } from '../testing/node-fs';

type Range = [number, number];
function unicodeRanges(css: string): Range[] {
  const out: Range[] = [];
  for (const block of css.matchAll(/unicode-range:\s*([^;]+);/g)) {
    for (const part of block[1]!.split(',')) {
      const m = /U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim());
      if (!m) continue;
      const lo = parseInt(m[1]!.replace(/\?/g, '0'), 16);
      const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1]!.replace(/\?/g, 'F'), 16);
      out.push([lo, hi]);
    }
  }
  return out;
}
const covered = (ranges: Range[], cp: number) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
const FONT_CSS: Record<string, string> = {};

const PRETENDARD = 'pretendard-jp/dist/web/variable/pretendardvariable-jp-dynamic-subset.css';
const BRICOLAGE = '@fontsource-variable/bricolage-grotesque/standard.css';
const MONO = '@fontsource-variable/jetbrains-mono/index.css';
for (const p of [PRETENDARD, BRICOLAGE, MONO]) FONT_CSS[p] = readRepoFile(`node_modules/${p}`);
const fontsCss = readRepoFile('frontend/src/styles/fonts.css');
const tokensCss = readRepoFile('frontend/src/styles/tokens.css');
const fontCss = (p: string) => FONT_CSS[p] ?? '';

describe('fonts.css imports exactly the three same-origin packages', () => {
  it('imports them and nothing remote', () => {
    const css = fontsCss;
    for (const p of [PRETENDARD, BRICOLAGE, MONO]) expect(css).toContain(`@import '${p}'`);
    expect(css).not.toMatch(/https?:/);
  });
});

describe('1 glyph coverage', () => {
  const pretendard = unicodeRanges(fontCss(PRETENDARD));
  const bricolage = unicodeRanges(fontCss(BRICOLAGE));
  const missing = (dict: Record<string, string>, ranges: Range[]) => {
    const set = new Set<string>();
    for (const v of Object.values(dict)) for (const ch of v) if (!covered(ranges, ch.codePointAt(0)!)) set.add(`U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} ${ch}`);
    return [...set].sort();
  };

  it('en text is covered by Pretendard JP (UI) — the Latin display font covers the Latin part', () => {
    const m = missing(en, pretendard);
    console.log(`[W2-R3] en code points missing from Pretendard JP: ${m.length}`, m);
    expect(m).toEqual([]);
    const latinOnly = Object.values(en).join('').replace(/[^\x20-\x7e]/g, '');
    const notInBricolage = missing({ latin: latinOnly }, bricolage);
    console.log(`[W2-R3] ASCII code points missing from Bricolage: ${notInBricolage.length}`);
    expect(notInBricolage).toEqual([]);
  });

  it('ja text is covered by Pretendard JP', () => {
    const m = missing(ja, pretendard);
    console.log(`[W2-R3] ja code points missing from Pretendard JP: ${m.length}`, m);
    expect(m).toEqual([]);
  });

  it('records Hangul syllable coverage of Pretendard JP (ko is off; informational)', () => {
    let n = 0;
    for (let cp = 0xac00; cp <= 0xd7a3; cp++) if (covered(pretendard, cp)) n++;
    console.log(`[W2-R3] Hangul syllables covered by Pretendard JP: ${n} / 11172`);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});

describe('2 contrast (accessibility.md section 1)', () => {
  const tokens = tokensCss;
  const hex = (name: string): [number, number, number] => {
    const m = new RegExp(`--${name}:\\s*#([0-9A-Fa-f]{6})`).exec(tokens);
    if (!m) throw new Error(`token --${name} is not a hex colour`);
    return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as [number, number, number];
  };
  const rgba = (name: string): [number, number, number, number] => {
    const m = new RegExp(`--${name}:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`).exec(tokens);
    if (!m) throw new Error(`token --${name} is not rgba`);
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  };
  const over = (top: [number, number, number, number], base: [number, number, number]): [number, number, number] =>
    [0, 1, 2].map((i) => top[i]! * top[3] + base[i]! * (1 - top[3])) as [number, number, number];
  const lum = (c: [number, number, number]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: [number, number, number], b: [number, number, number]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  };

  const pairs: [string, () => number, number][] = [
    ['text / ink-950', () => ratio(hex('text'), hex('ink-950')), 4.5],
    ['text / ink-850', () => ratio(hex('text'), hex('ink-850')), 4.5],
    ['text / felt', () => ratio(hex('text'), hex('felt')), 4.5],
    ['text-muted / ink-850', () => ratio(hex('text-muted'), hex('ink-850')), 4.5],
    ['text-muted / felt', () => ratio(hex('text-muted'), hex('felt')), 4.5],
    ['text-subtle / ink-850', () => ratio(hex('text-subtle'), hex('ink-850')), 4.5],
    ['accent / ink-950', () => ratio(hex('accent'), hex('ink-950')), 4.5],
    ['accent / felt (UI, large)', () => ratio(hex('accent'), hex('felt')), 3],
    ['text-on-accent / accent', () => ratio(hex('text-on-accent'), hex('accent')), 4.5],
    ['text-on-accent / critical', () => ratio(hex('text-on-accent'), hex('critical')), 4.5],
    ['good / ink-850', () => ratio(hex('good'), hex('ink-850')), 4.5],
    ['warn / ink-850', () => ratio(hex('warn'), hex('ink-850')), 4.5],
    ['critical / ink-850', () => ratio(hex('critical'), hex('ink-850')), 4.5],
    ['info / ink-850', () => ratio(hex('info'), hex('ink-850')), 4.5],
    ['critical / critical-soft over ink-850', () => ratio(hex('critical'), over(rgba('critical-soft'), hex('ink-850'))), 4.5],
    ['accent / accent-soft over ink-850', () => ratio(hex('accent'), over(rgba('accent-soft'), hex('ink-850'))), 4.5],
    ['warn / warn-soft over ink-850 (estimate badge)', () => ratio(hex('warn'), over(rgba('warn-soft'), hex('ink-850'))), 4.5],
    ['info / info-soft over ink-850', () => ratio(hex('info'), over(rgba('info-soft'), hex('ink-850'))), 4.5],
    ['suit-red / card-face', () => ratio(hex('suit-red'), hex('card-face')), 4.5],
    ['suit-black / card-face', () => ratio(hex('suit-black'), hex('card-face')), 4.5],
    ['line-strong / ink-900 (UI)', () => ratio(hex('line-strong'), hex('ink-900')), 3],
    ['line-strong / ink-850 (UI)', () => ratio(hex('line-strong'), hex('ink-850')), 3],
    ['focus / ink-950 (UI)', () => ratio(hex('focus'), hex('ink-950')), 3],
    ...[1, 2, 3, 4, 5, 6].map((n): [string, () => number, number] => [`seat-${n} / ink-950 initial`, () => ratio(hex(`seat-${n}`), hex('ink-950')), 4.5]),
  ];

  it.each(pairs)('%s', (name, compute, min) => {
    const value = compute();
    console.log(`[W2-R3] contrast ${name}: ${value.toFixed(2)} (min ${min})`);
    expect(value).toBeGreaterThanOrEqual(min);
  });
});

describe('3 variable axes', () => {
  const tokens = tokensCss;
  const weights = [...tokens.matchAll(/--fw-[a-z]+:\s*(\d+)/g)].map((m) => Number(m[1]));
  const range = (css: string) => {
    const m = /font-weight:\s*(\d+)\s+(\d+)/.exec(css);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };

  it('token weights fit every family', () => {
    expect(weights.length).toBeGreaterThan(0);
    for (const [name, p] of [['Pretendard JP', PRETENDARD], ['Bricolage', BRICOLAGE], ['JetBrains Mono', MONO]] as const) {
      const r = range(fontCss(p));
      console.log(`[W2-R3] ${name} weight range ${r?.join('-')}; token weights ${weights.join(', ')}`);
      expect(r).not.toBeNull();
      for (const w of weights) expect(w >= r![0]! && w <= r![1]!, `${name} ${w}`).toBe(true);
    }
  });

  it('Bricolage standard declares the width axis 75-100% (opsz not declared -> [unverified], W6 browser check)', () => {
    expect(fontCss(BRICOLAGE)).toMatch(/font-stretch:\s*75% 100%/);
    expect(fontCss(BRICOLAGE)).not.toMatch(/opsz/);
  });
});

// Diagnostics payload: browser = name + major version only, never the full UA; shape matches api.config.v1.
import { describe, expect, it } from 'vitest';
import { browserName, buildDiagnostics } from './diagnostics';

describe('browserName', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', 'Chrome 141'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', 'Edge 141'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0', 'Firefox 133'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', 'Safari 18'],
    ['curl/8.0', 'unknown'],
  ])('%s -> %s', (ua, expected) => {
    expect(browserName(ua)).toBe(expected);
  });
});

describe('buildDiagnostics', () => {
  it('has the contract shape with empty connection fields', () => {
    const d = buildDiagnostics('E-ENG-INVARIANT');
    expect(d).toMatchObject({ v: 1, code: 'E-ENG-INVARIANT', stages: [], relaysOpen: 0, relaysTotal: 0, natHint: 'unknown', appVersion: 'dev' });
    expect(d.browser.length).toBeLessThanOrEqual(40);
    expect(Array.isArray(d.recent)).toBe(true);
  });
});

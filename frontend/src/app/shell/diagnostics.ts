// Diagnostics copy payload (api.config.v1 diagnostics, M3A-23) for screen errors outside the connection flow
// (practice E-ENG-INVARIANT). Same shape as R-04's copy; the connection fields are empty because practice has no
// network. 2-3 fills stages/relays/natHint from session diagnose() for R-04 and reuses this builder.
// Never included: IP, room code, nickname, rpk, keys, cards, chat (only codes and timestamps from the debug log).
import { APP_VERSION, getDebugLog, type DebugCode, type ErrorCode } from '@/config';

export interface Diagnostics {
  v: 1;
  code: ErrorCode | null;
  stages: { stage: string; ms: number }[];
  relaysOpen: number;
  relaysTotal: number;
  natHint: 'stun_ok' | 'symmetric_suspected' | 'no_srflx' | 'unknown';
  online: boolean;
  browser: string;
  appVersion: string;
  recent: { code: DebugCode; atMs: number }[];
}

const RECENT_MAX = 20;
// Order matters: Edge and Opera user agents also contain "Chrome", Chrome's contains "Safari".
const BROWSERS: [RegExp, string][] = [
  [/Edg\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
  [/Firefox\/(\d+)/, 'Firefox'],
  [/Chrome\/(\d+)/, 'Chrome'],
  [/Version\/(\d+)[\d.]* .*Safari\//, 'Safari'],
];

/** Browser name + major version only ("Chrome 141"); never the full user agent. */
export function browserName(userAgent: string): string {
  for (const [re, name] of BROWSERS) {
    const m = re.exec(userAgent);
    if (m?.[1] !== undefined) return `${name} ${m[1]}`;
  }
  return 'unknown';
}

export function buildDiagnostics(code: ErrorCode | null): Diagnostics {
  return {
    v: 1,
    code,
    stages: [],
    relaysOpen: 0,
    relaysTotal: 0,
    natHint: 'unknown',
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    browser: typeof navigator === 'undefined' ? 'unknown' : browserName(navigator.userAgent),
    appVersion: APP_VERSION,
    recent: getDebugLog()
      .slice(-RECENT_MAX)
      .map((e) => ({ code: e.code, atMs: Math.round(e.atMs) })),
  };
}

// Build-time feature flags (ADR-0012). Each flag reads `import.meta.env.VITE_*` directly (no alias such as
// `const env = import.meta.env`), so Vite replaces every read with a string literal at build time and the
// minifier can fold the comparison to true/false. An alias makes Vite inline the whole env object instead, and
// code behind a false flag (for example the ko chunk) is no longer removed. Release builds must keep E2E === false.
export const flags = {
  /** Dormant routes and the server API client (Phase 2). */
  FEATURE_SERVER: import.meta.env.VITE_FEATURE_SERVER === 'true',
  /** ko strings, /ko/ landing, hreflang, sitemap. */
  FEATURE_KO: import.meta.env.VITE_FEATURE_KO === 'true',
  /** Local LLM provider (set to 'false' if the W5 manual check fails). */
  FEATURE_LOCAL_LLM: import.meta.env.VITE_FEATURE_LOCAL_LLM !== 'false',
  /** /arena, home card, "watch bots only" after the demo. */
  FEATURE_ARENA: import.meta.env.VITE_FEATURE_ARENA !== 'false',
  /** Landing demo slot (static poster when off). */
  FEATURE_LANDING_DEMO: import.meta.env.VITE_FEATURE_LANDING_DEMO !== 'false',
  /** getIceServers() fetches TURN credentials (D26: not used). */
  FEATURE_TURN: import.meta.env.VITE_FEATURE_TURN === 'true',
  /** Comma separated language list that gets the adult-confirmation step, e.g. "ko". */
  ADULT_CHECK: import.meta.env.VITE_ADULT_CHECK ?? '',
  /** Test hooks (DV shortcuts, seed, LLM mock, relay override, tap). */
  E2E: import.meta.env.VITE_E2E === 'true',
} as const;

export type Flags = typeof flags;

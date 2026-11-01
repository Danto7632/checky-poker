// Build-time feature flags (ADR-0012). Vite replaces `import.meta.env.VITE_*` at build time.
// Release builds must keep E2E === false.
const env = import.meta.env;

export const flags = {
  /** Dormant routes and the server API client (Phase 2). */
  FEATURE_SERVER: env.VITE_FEATURE_SERVER === 'true',
  /** ko strings, /ko/ landing, hreflang, sitemap. */
  FEATURE_KO: env.VITE_FEATURE_KO === 'true',
  /** Local LLM provider (set to 'false' if the W5 manual check fails). */
  FEATURE_LOCAL_LLM: env.VITE_FEATURE_LOCAL_LLM !== 'false',
  /** /arena, home card, "watch bots only" after the demo. */
  FEATURE_ARENA: env.VITE_FEATURE_ARENA !== 'false',
  /** Landing demo slot (static poster when off). */
  FEATURE_LANDING_DEMO: env.VITE_FEATURE_LANDING_DEMO !== 'false',
  /** getIceServers() fetches TURN credentials (D26: not used). */
  FEATURE_TURN: env.VITE_FEATURE_TURN === 'true',
  /** Comma separated language list that gets the adult-confirmation step, e.g. "ko". */
  ADULT_CHECK: env.VITE_ADULT_CHECK ?? '',
  /** Test hooks (DV shortcuts, seed, LLM mock, relay override, tap). */
  E2E: env.VITE_E2E === 'true',
} as const;

export type Flags = typeof flags;

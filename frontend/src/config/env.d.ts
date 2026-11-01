/// <reference types="vite/client" />

// Build-time environment of the app (api.config.v1). Flags are read in flags.ts, never anywhere else.
interface ImportMetaEnv {
  readonly VITE_FEATURE_SERVER?: string;
  readonly VITE_FEATURE_KO?: string;
  readonly VITE_FEATURE_LOCAL_LLM?: string;
  readonly VITE_FEATURE_ARENA?: string;
  readonly VITE_FEATURE_LANDING_DEMO?: string;
  readonly VITE_FEATURE_TURN?: string;
  readonly VITE_ADULT_CHECK?: string;
  readonly VITE_E2E?: string;
  /** Build git sha (7 chars), injected by frontend/vite.config.ts `define` (Andrew). Not a flag. */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** E2E hook object. Only read when VITE_E2E === 'true' (see e2e.ts). */
  __CHECKY_E2E__?: unknown;
}

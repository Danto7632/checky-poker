// api.config.v1 — shared config, diagnostics, app version and E2E hooks. Owned by the lead, frozen during W5.
export { flags } from './flags';
export type { Flags } from './flags';
export { defaults } from './defaults';
export type { Defaults } from './defaults';
export { debugLog, getDebugLog } from './debug-log';
export type { ConnStageLit, DebugCode, DebugData, DebugEntry, DebugValue, StreetLit } from './debug-log';
export { APP_VERSION } from './app-version';
export { getE2EHooks } from './e2e';
export type { E2EHooks } from './e2e';
export { ERROR_CODES, NOTICE_CODES } from './contract-codes';
export type { ErrorCode, NoticeCode } from './contract-codes';

// Single supplier of appVersion for HandRecordV1, ExportFileV1 and diagnostics (S11-F15).
// The value is injected by frontend/vite.config.ts (`define`, Andrew); without it the app reports 'dev'.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

// CheckyError: the single error class every module throws (AF-33, story-map I-25).
//
// The message is the code itself on purpose. Exception messages end up in consoles, crash reports and the
// diagnostics copy (R-04), so they must never carry cards, nicknames, room codes, rpk or keys. Put any detail a
// developer needs into `cause` (kept off the wire; callers decide whether to log it).
//
// Other modules that cannot import util (app) discriminate with `{code}` instead of `instanceof`.
import type { ErrorCode } from '../protocol/codes';

export class CheckyError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, options?: { cause?: unknown }) {
    super(code, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CheckyError';
    this.code = code;
  }
}

/** True for a CheckyError thrown in this realm (a structured clone loses the class; compare `code` there). */
export function isCheckyError(e: unknown): e is CheckyError {
  return e instanceof CheckyError;
}

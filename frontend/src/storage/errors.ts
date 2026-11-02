// Storage failure mapping (exceptions.md 2.6). Only three codes reach the UI from R0 storage, all as a banner;
// the game keeps running in every case (SC3).
import { CheckyError } from '@checky/engine/util';

/** True for a write rejected because the origin is out of quota (name differs across engines). */
export function isQuotaError(e: unknown): boolean {
  const name = typeof e === 'object' && e !== null && 'name' in e ? (e as { name: unknown }).name : undefined;
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/** Rethrow a failed write as CheckyError('E-STO-QUOTA') when it is a quota error; anything else is rethrown as-is. */
export function mapWriteError(e: unknown): never {
  if (isQuotaError(e)) throw new CheckyError('E-STO-QUOTA', { cause: e });
  throw e;
}

// Record version chain (data-model section 10): read any stored/exported/shared record through upgradeRecord so
// newer code always sees the latest shape. v1 is the only version today, so the chain is the identity plus a
// version check; v2 will add `if (v === 1) rec = v1ToV2(rec)` here. Converters are never deleted (export files
// and share links keep old versions alive).
import { CheckyError } from '../util/checky-error';
import type { HandRecordV1 } from './types';

/** Throws CheckyError('E-STO-IMPORT-NEWER') for a version this code does not know, E-STO-IMPORT-CORRUPT for junk. */
export function upgradeRecord(raw: unknown): HandRecordV1 {
  if (typeof raw !== 'object' || raw === null || !('v' in raw)) throw new CheckyError('E-STO-IMPORT-CORRUPT');
  const v = (raw as { v: unknown }).v;
  if (v === 1) return raw as HandRecordV1;
  if (typeof v === 'number' && v > 1) throw new CheckyError('E-STO-IMPORT-NEWER');
  throw new CheckyError('E-STO-IMPORT-CORRUPT');
}

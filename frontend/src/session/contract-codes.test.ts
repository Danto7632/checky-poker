// AC-2: the engine's copies of the contract enums equal the lead-extracted truth in frontend/src/config.
// config's ERROR_CODES/NOTICE_CODES are proven identical to contract-codes.json by config/contract-codes.test.ts
// (lead), and deep imports into @/config are banned, so this test compares against the config index.
// Type-level checks run under `npm run typecheck` (this file is part of the frontend tsconfig).
import { describe, expect, it } from 'vitest';
import {
  CONN_STAGES,
  ERROR_CODES,
  NOTICE_CODES,
  PROTOCOL_VERSION,
  STREETS,
  type ConnStage,
  type Street,
} from '@checky/engine/protocol';
import { ERROR_CODES as CONFIG_ERROR_CODES, NOTICE_CODES as CONFIG_NOTICE_CODES, defaults } from '@/config';
import { MAX_ENVELOPE_BYTES } from '@checky/engine/protocol';
import { RUNOUT_DELAYS_MS } from '@checky/engine/table';
import type { ConnStageLit, ErrorCode as ConfigErrorCode, NoticeCode as ConfigNoticeCode, StreetLit } from '@/config';
import type { ErrorCode, NoticeCode } from '@checky/engine/protocol';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const connStagesMatch: Equal<ConnStage, ConnStageLit> = true;
const streetsMatch: Equal<Street, StreetLit> = true;
const errorCodesMatch: Equal<ErrorCode, ConfigErrorCode> = true;
const noticeCodesMatch: Equal<NoticeCode, ConfigNoticeCode> = true;

describe('contract codes and enums', () => {
  it('ERROR_CODES equals the contract-codes errors (67, no difference either way)', () => {
    expect(CONFIG_ERROR_CODES).toHaveLength(67);
    expect([...ERROR_CODES].sort()).toEqual([...CONFIG_ERROR_CODES].sort());
    expect(errorCodesMatch).toBe(true);
  });

  it('NOTICE_CODES equals the contract-codes notices (13)', () => {
    expect(CONFIG_NOTICE_CODES).toHaveLength(13);
    expect([...NOTICE_CODES].sort()).toEqual([...CONFIG_NOTICE_CODES].sort());
    expect(noticeCodesMatch).toBe(true);
  });

  it('ConnStage and Street have the same members as config ConnStageLit and StreetLit', () => {
    expect(connStagesMatch && streetsMatch).toBe(true);
    expect(CONN_STAGES).toHaveLength(10);
    expect(STREETS).toEqual(['PREFLOP', 'FLOP', 'TURN', 'RIVER', 'RUNOUT', 'SHOWDOWN', 'COMPLETE', 'VOIDED']);
  });

  it("PROTOCOL_VERSION is '1.0' (T-023)", () => {
    expect(PROTOCOL_VERSION).toBe('1.0');
  });

  it('engine constants that mirror config defaults stay equal (max envelope bytes, runout pacing)', () => {
    expect(MAX_ENVELOPE_BYTES).toBe(defaults.maxEnvelopeBytes);
    expect([...RUNOUT_DELAYS_MS]).toEqual([...defaults.runoutDelaysMs]);
  });
});

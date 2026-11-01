import { describe, expect, it } from 'vitest';
import codes from './contract-codes.json';
import { ERROR_CODES, NOTICE_CODES } from './contract-codes';

describe('contract-codes.json / contract-codes.ts', () => {
  it('has 67 error codes and 13 notice codes for contract 1.0.4', () => {
    expect(codes.contract_version).toBe('1.0.4');
    expect(codes.errors).toHaveLength(67);
    expect(codes.notices).toHaveLength(13);
  });

  it('keeps the ts arrays identical to the json ids, sorted ascending without duplicates', () => {
    const errorIds = codes.errors.map((e) => e.id);
    const noticeIds = codes.notices.map((n) => n.id);
    expect([...ERROR_CODES]).toEqual(errorIds);
    expect([...NOTICE_CODES]).toEqual(noticeIds);
    for (const ids of [errorIds, noticeIds]) {
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps the documented fields on every entry', () => {
    for (const e of codes.errors) expect(Object.keys(e)).toEqual(['id', 'owner', 'surface', 'retry']);
    for (const n of codes.notices) expect(Object.keys(n)).toEqual(['id', 'to', 'p', 'ss', 'us']);
  });
});

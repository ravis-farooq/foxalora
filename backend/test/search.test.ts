import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_LENGTH, MAX_SEARCH_RESULTS, searchCriteria } from '../src/mail/search';

describe('searchCriteria (quick search, mapped to IMAP SEARCH)', () => {
  it('returns null for no or blank input, so the plain list is used', () => {
    expect(searchCriteria(undefined)).toBeNull();
    expect(searchCriteria('')).toBeNull();
    expect(searchCriteria('   ')).toBeNull();
  });

  it('matches subject, sender or recipient with the trimmed text', () => {
    expect(searchCriteria('  report ')).toEqual({ or: [{ subject: 'report' }, { from: 'report' }, { to: 'report' }] });
  });

  it('keeps quotes and non-Latin text as data (the IMAP library quotes or literals them)', () => {
    expect(searchCriteria('"lunch" تجريبية')).toEqual({ or: [{ subject: '"lunch" تجريبية' }, { from: '"lunch" تجريبية' }, { to: '"lunch" تجريبية' }] });
  });

  it('rejects control characters, which could end the IMAP command line', () => {
    for (const bad of ['a\r\nA1 LOGOUT', 'x\u0000y', 'tab\there', 'del\u007f']) {
      expect(() => searchCriteria(bad)).toThrow(BadRequestException);
    }
  });

  it('rejects over-long input and non-strings', () => {
    expect(() => searchCriteria('x'.repeat(MAX_SEARCH_LENGTH + 1))).toThrow(BadRequestException);
    expect(searchCriteria('x'.repeat(MAX_SEARCH_LENGTH))).not.toBeNull();
    expect(() => searchCriteria(['a', 'b'])).toThrow(BadRequestException);
    expect(() => searchCriteria({ subject: 'a' })).toThrow(BadRequestException);
  });

  it('caps the number of results it will page through', () => {
    expect(MAX_SEARCH_RESULTS).toBeGreaterThanOrEqual(100);
    expect(MAX_SEARCH_RESULTS).toBeLessThanOrEqual(5000);
  });
});

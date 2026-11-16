import { describe, expect, it } from 'vitest';
import { loginFailureReason } from '../src/auth/login-reason';

describe('loginFailureReason (auth log)', () => {
  it('names IMAP authentication failures with the server response code only', () => {
    const e = Object.assign(new Error('Command failed'), {
      authenticationFailed: true,
      serverResponseCode: 'AUTHENTICATIONFAILED',
      response: 'a1 NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)',
    });
    expect(loginFailureReason(e)).toBe('imap_auth:AUTHENTICATIONFAILED');
  });

  it('names SMTP authentication failures without the server text', () => {
    const e = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
      code: 'EAUTH',
      responseCode: 535,
      response: '535-5.7.8 Username and Password not accepted',
    });
    expect(loginFailureReason(e)).toBe('smtp_auth:535');
  });

  it('keeps network error codes', () => {
    expect(loginFailureReason(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe('ETIMEDOUT');
  });

  it('never echoes free text, passwords or long values', () => {
    const secret = 'hunter2-app-password';
    const e = Object.assign(new Error(`login ${secret}`), {
      authenticationFailed: true,
      serverResponseCode: `ALERT ${secret}`,
    });
    const r = loginFailureReason(e);
    expect(r).not.toContain(secret);
    expect(r).toBe('imap_auth:other');
    expect(loginFailureReason(Object.assign(new Error('y'), { code: `E ${secret}` }))).toBe('error');
    expect(loginFailureReason('plain string')).toBe('error');
  });
});

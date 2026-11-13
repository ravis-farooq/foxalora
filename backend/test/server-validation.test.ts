import { describe, expect, it } from 'vitest';
import { validateServerInput, type ServerInput } from '../src/registry/server-validation';

const ok: ServerInput = {
  name: 'mail1', imapHost: 'mail1.host.com', imapPort: 993, imapTls: 'tls',
  smtpHost: 'mail1.host.com', smtpPort: 587, smtpTls: 'starttls', allowPrivate: false,
};

describe('mail server validation (FOX-006)', () => {
  it('accepts the common real setup: IMAP 993 TLS with SMTP 587 STARTTLS (D23)', () => {
    expect(validateServerInput(ok, { production: true })).toEqual({ ...ok, savesSent: false });
  });

  it('keeps the "server saves sent mail itself" setting only when it is exactly true (OPEN-4)', () => {
    expect(validateServerInput({ ...ok, savesSent: true }, { production: true }).savesSent).toBe(true);
    expect(validateServerInput({ ...ok, savesSent: 'yes' as never }, { production: true }).savesSent).toBe(false);
  });

  it('accepts the other standard port and TLS pairs', () => {
    for (const [imapPort, imapTls, smtpPort, smtpTls] of [[143, 'starttls', 465, 'tls'], [993, 'tls', 25, 'starttls']] as const)
      expect(() => validateServerInput({ ...ok, imapPort, imapTls, smtpPort, smtpTls }, { production: true })).not.toThrow();
  });

  it('rejects non-mail ports and mismatched port/TLS pairs', () => {
    expect(() => validateServerInput({ ...ok, imapPort: 6379 }, { production: true })).toThrow(/IMAP port/);
    expect(() => validateServerInput({ ...ok, smtpPort: 22 }, { production: true })).toThrow(/SMTP port/);
    expect(() => validateServerInput({ ...ok, imapPort: 143, imapTls: 'tls' }, { production: true })).toThrow(/IMAP port/);
    expect(() => validateServerInput({ ...ok, smtpPort: 465, smtpTls: 'starttls' }, { production: true })).toThrow(/SMTP port/);
  });

  it('refuses unencrypted connections in production but allows them for local dev servers', () => {
    const dev: ServerInput = { ...ok, imapPort: 3143, imapTls: 'none-dev-only', smtpPort: 3025, smtpTls: 'none-dev-only' };
    expect(() => validateServerInput(dev, { production: true })).toThrow(/production/);
    expect(validateServerInput(dev, { production: false }).imapPort).toBe(3143);
  });

  it('rejects malformed hosts and names, and normalises host case', () => {
    for (const imapHost of ['', 'bad host', 'http://x.com', 'x'.repeat(254), 'a..b', '-a.com'])
      expect(() => validateServerInput({ ...ok, imapHost }, { production: true }), imapHost).toThrow(/host/);
    expect(() => validateServerInput({ ...ok, name: '' }, { production: true })).toThrow(/name/);
    expect(validateServerInput({ ...ok, imapHost: 'MAIL1.Host.COM' }, { production: true }).imapHost).toBe('mail1.host.com');
    expect(validateServerInput({ ...ok, imapHost: '203.0.113.7' }, { production: true }).imapHost).toBe('203.0.113.7');
  });
});

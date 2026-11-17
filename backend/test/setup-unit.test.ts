import { afterEach, describe, expect, it } from 'vitest';
import { adminPasswordProblem, hashAdminPassword, verifyAdminPassword } from '../src/setup/admin-password';
import { parseServer, parseSetupInput, parseTestMailbox } from '../src/setup/setup-input';

const server = { imapHost: 'Mail.HostCo.example', imapPort: 993, imapTls: 'tls', smtpHost: '', smtpPort: 587, smtpTls: 'starttls' };
const valid = { organisation: 'HostCo', admin: { email: 'Admin@HostCo.example', password: 'correct horse battery' }, server, domains: ['HostCo.example', 'hostco.example', 'client.example'] };

describe('administrator passwords (FOX-081)', () => {
  it('hashes with scrypt and a random salt, and verifies', async () => {
    const a = await hashAdminPassword('correct horse battery');
    const b = await hashAdminPassword('correct horse battery');
    expect(a).toMatch(/^scrypt\$131072\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(a).not.toBe(b);
    expect(a).not.toContain('correct horse');
    expect(await verifyAdminPassword('correct horse battery', a)).toBe(true);
    expect(await verifyAdminPassword('correct horse batterz', a)).toBe(false);
  });

  it('rejects malformed or tampered hashes without running scrypt with their parameters', async () => {
    expect(await verifyAdminPassword('x', 'plain-text')).toBe(false);
    expect(await verifyAdminPassword('x', 'scrypt$1073741824$8$1$c2FsdA$aGFzaA')).toBe(false);
  });

  it('asks for length, not composition (NIST SP 800-63B)', () => {
    expect(adminPasswordProblem('short', 'a@b.example')).toMatch(/12/);
    expect(adminPasswordProblem('aaaaaaaaaaaa', 'a@b.example')).toBeNull();
    expect(adminPasswordProblem('admin@hostco.example', 'admin@hostco.example')).toMatch(/email/);
    expect(adminPasswordProblem(undefined, 'a@b.example')).not.toBeNull();
  });
});

describe('setup wizard input', () => {
  afterEach(() => { delete process.env.NODE_ENV; process.env.NODE_ENV = 'test'; });

  it('normalises the server, defaults SMTP host and name to the IMAP host, dedupes domains', () => {
    const s = parseSetupInput(valid);
    expect(s.admin.email).toBe('admin@hostco.example');
    expect(s.server).toMatchObject({ name: 'mail.hostco.example', imapHost: 'mail.hostco.example', smtpHost: 'mail.hostco.example', allowPrivate: false });
    expect(s.domains).toEqual(['hostco.example', 'client.example']);
  });

  it('refuses non-standard port and TLS pairs, and unencrypted servers in production', () => {
    expect(() => parseServer({ ...server, imapPort: 143 })).toThrow(/standard port/);
    process.env.NODE_ENV = 'production';
    expect(() => parseServer({ ...server, imapTls: 'none-dev-only', imapPort: 143 })).toThrow(/refused in production/);
  });

  it('requires an organisation, a valid admin, a strong password and at least one valid domain', () => {
    expect(() => parseSetupInput({ ...valid, organisation: ' ' })).toThrow(/company/);
    expect(() => parseSetupInput({ ...valid, admin: { email: 'nope', password: 'correct horse battery' } })).toThrow(/email/);
    expect(() => parseSetupInput({ ...valid, admin: { ...valid.admin, password: 'short' } })).toThrow(/12/);
    expect(() => parseSetupInput({ ...valid, domains: [] })).toThrow(/at least one/);
    expect(() => parseSetupInput({ ...valid, domains: ['not a domain'] })).toThrow(/invalid/);
  });

  it('treats the test mailbox as optional, but complete when given', () => {
    expect(parseTestMailbox(undefined)).toBeUndefined();
    expect(parseTestMailbox({ email: '', password: '' })).toBeUndefined();
    expect(parseTestMailbox({ email: 'a@b.example', password: 'p' })).toEqual({ user: 'a@b.example', pass: 'p' });
    expect(() => parseTestMailbox({ email: 'a@b.example' })).toThrow(/password/);
  });
});

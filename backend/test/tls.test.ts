import { readFileSync } from 'node:fs';
import { createServer as createNetServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { openImap } from '../src/mail/connections';
import type { MailServer } from '../src/registry/registry.service';

const dir = process.env.FOXALORA_TEST_CERTS_DIR!;
const pem = (f: string) => readFileSync(join(dir, f));

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

/** Minimal IMAP server: greets, answers CAPABILITY, refuses every login. Records what it received. */
function imapResponder(socket: NodeJS.ReadWriteStream & { write(s: string): boolean }, received: string[], caps: string) {
  socket.write(`* OK [CAPABILITY ${caps}] test ready\r\n`);
  socket.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\r\n').filter(Boolean)) {
      received.push(line);
      const [tag, cmd] = line.split(' ');
      if (/^CAPABILITY$/i.test(cmd)) socket.write(`* CAPABILITY ${caps}\r\n${tag} OK done\r\n`);
      else if (/^LOGOUT$/i.test(cmd)) socket.write(`* BYE\r\n${tag} OK bye\r\n`);
      else if (/^(LOGIN|AUTHENTICATE)$/i.test(cmd)) socket.write(`${tag} NO [AUTHENTICATIONFAILED] nope\r\n`);
      else if (tag) socket.write(`${tag} BAD unsupported\r\n`);
    }
  });
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

async function tlsImap(cert: string, key: string): Promise<{ port: number; received: string[] }> {
  const received: string[] = [];
  const port = await listen(createTlsServer({ cert: pem(cert), key: pem(key) }, (s) => imapResponder(s, received, 'IMAP4rev1 AUTH=PLAIN')));
  return { port, received };
}

const server = (port: number, imapTls: MailServer['imapTls'] = 'tls'): MailServer => ({
  id: 's', tenantId: 't', imapHost: 'localhost', imapPort: port, imapTls,
  smtpHost: 'localhost', smtpPort: 587, smtpTls: 'starttls', allowPrivate: true,
});

const attempt = (port: number, tls: MailServer['imapTls'] = 'tls') =>
  openImap({ email: 'u@x.example', password: 'canary-password', server: server(port, tls) }).then(
    () => ({ code: 'connected' }),
    (e: { code?: string; authenticationFailed?: boolean }) => ({ code: e.authenticationFailed ? 'auth_failed' : e.code ?? String(e) }),
  );

describe('TLS policy enforcement (FOX-026)', () => {
  it('a valid certificate for the configured host name gets through TLS (then the fake server refuses the login)', async () => {
    const { port, received } = await tlsImap('valid.pem', 'valid-key.pem');
    expect((await attempt(port)).code).toBe('auth_failed');
    expect(received.some((l) => /LOGIN|AUTHENTICATE/i.test(l))).toBe(true);
  });

  it.each([
    ['expired certificate', 'expired.pem', 'expired-key.pem', 'CERT_HAS_EXPIRED'],
    ['certificate for another host name', 'wrongname.pem', 'wrongname-key.pem', 'ERR_TLS_CERT_ALTNAME_INVALID'],
    ['self-signed / untrusted issuer', 'selfsigned.pem', 'selfsigned-key.pem', 'DEPTH_ZERO_SELF_SIGNED_CERT'],
  ])('refuses a %s and never sends credentials', async (_label, cert, key, code) => {
    const { port, received } = await tlsImap(cert, key);
    expect((await attempt(port)).code).toBe(code);
    expect(received).toEqual([]);
  });

  it('refuses TLS 1.1 servers (minimum TLS 1.2)', async () => {
    const received: string[] = [];
    const port = await listen(createTlsServer({ cert: pem('valid.pem'), key: pem('valid-key.pem'), maxVersion: 'TLSv1.1', minVersion: 'TLSv1' }, (s) => imapResponder(s, received, 'IMAP4rev1')));
    expect((await attempt(port)).code).not.toMatch(/auth_failed|connected/);
    expect(received).toEqual([]);
  });

  it('STARTTLS required but not offered is an error, and no password is sent in clear text', async () => {
    const received: string[] = [];
    const port = await listen(createNetServer((s) => imapResponder(s, received, 'IMAP4rev1 AUTH=PLAIN')));
    const r = await attempt(port, 'starttls');
    expect(r.code).not.toMatch(/auth_failed|connected/);
    expect(received.some((l) => /LOGIN|AUTHENTICATE|canary/i.test(l))).toBe(false);
  });

  it('refuses an unencrypted policy in production even if the database contains one', async () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(openImap({ email: 'u@x', password: 'p', server: server(3143, 'none-dev-only') })).rejects.toThrow(/refused in production/);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});

describe('SSRF guard on real connections (FOX-025)', () => {
  it('refuses a private destination unless the server is explicitly allowed', async () => {
    const { port, received } = await tlsImap('valid.pem', 'valid-key.pem');
    const r = await openImap({ email: 'u@x', password: 'p', server: { ...server(port), allowPrivate: false } }).catch((e) => e);
    expect(r.code).toBe('SSRF_BLOCKED');
    expect(received).toEqual([]);
  });
});

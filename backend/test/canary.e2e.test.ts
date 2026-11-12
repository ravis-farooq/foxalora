import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Logger, type INestApplication, type LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../src/mail/mail.service';
import { createTestDatabase, hasPg, type TestDatabase } from './helpers/pg';

const VALKEY = process.env.FOXALORA_TEST_VALKEY_URL ?? '';
const CANARY = `Canary-${randomBytes(6).toString('hex')}`; // the mailbox password
const CANARY_B64 = Buffer.from(CANARY).toString('base64');
const WRONG = `Wrong-${randomBytes(6).toString('hex')}`;

/** Simulates mail libraries that echo credentials and commands in their errors. */
class LeakyFakeMail {
  async verifyLogin({ password }: { password: string }) {
    if (password !== CANARY) {
      throw Object.assign(new Error(`535 5.7.8 auth failed for "${password}"`), { code: 'EAUTH', response: `AUTH PLAIN ${Buffer.from(password).toString('base64')}` });
    }
  }
  async listFolders() {
    return [{ path: 'INBOX', name: 'INBOX', specialUse: '\\Inbox', total: 0, unseen: 0 }];
  }
  async getMessage() {
    // Raw, un-normalised library error: the global filter is the last line of defence.
    throw Object.assign(new Error(`Command failed: A3 LOGIN alice ${CANARY}`), { executedCommand: `A3 LOGIN alice ${CANARY}`, responseText: CANARY });
  }
  async send() {
    return { to: [], cc: [], bcc: [] };
  }
}

describe.skipIf(!hasPg || !VALKEY)('end to end: secrets never leak; cookies and CSRF (FOX-090, FOX-119, FOX-019)', () => {
  let t: TestDatabase;
  let app: INestApplication;
  let base: string;
  let redis: Redis;
  const logs: string[] = [];
  const captured: string[] = [];
  const record = (s: unknown) => captured.push(typeof s === 'string' ? s : JSON.stringify(s));

  beforeAll(async () => {
    t = await createTestDatabase();
    const tenant = await t.owner.insertInto('tenants').values({ name: 'E2E' }).returning('id').executeTakeFirstOrThrow();
    const server = await t.owner.insertInto('mail_servers').values({
      tenant_id: tenant.id, name: 'm', imap_host: 'mail.e2e.example', imap_port: 993, imap_tls: 'tls',
      smtp_host: 'mail.e2e.example', smtp_port: 587, smtp_tls: 'starttls', allow_private: false,
    }).returning('id').executeTakeFirstOrThrow();
    await t.owner.insertInto('domain_mappings').values({ tenant_id: tenant.id, domain: 'e2e.example', mail_server_id: server.id }).execute();

    const valkeyUrl = new URL(VALKEY);
    valkeyUrl.pathname = '/13';
    Object.assign(process.env, {
      DATABASE_URL: t.appUrl,
      VALKEY_URL: valkeyUrl.toString(),
      FOXALORA_VAULT_KEYS: `e2e:${randomBytes(32).toString('base64')}`,
      LOGIN_MIN_FAILURE_MS: '0',
    });
    redis = new Redis(valkeyUrl.toString());
    await redis.flushdb();

    const logger: LoggerService = {
      log: (m) => logs.push(String(m)), error: (m, ...r) => logs.push([m, ...r].map(String).join(' ')),
      warn: (m) => logs.push(String(m)), debug: (m) => logs.push(String(m)), verbose: (m) => logs.push(String(m)),
    };
    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/http');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailService).useValue(new LeakyFakeMail()).compile();
    app = mod.createNestApplication({ bodyParser: false, logger });
    Logger.overrideLogger(logger);
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;
  });

  afterAll(async () => {
    await app?.close();
    await redis?.flushdb();
    redis?.disconnect();
    await t?.drop();
  });

  const req = async (method: string, path: string, opts: { body?: unknown; cookie?: string; csrf?: boolean; headers?: Record<string, string> } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.csrf === false ? {} : { 'X-Requested-With': 'foxalora' }),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        ...opts.headers,
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    record(text);
    record([...res.headers.entries()]);
    return { status: res.status, text, cookie: res.headers.get('set-cookie') ?? '' };
  };
  const login = (password: string, cookie?: string) => req('POST', '/auth/login', { body: { email: 'alice@e2e.example', password }, cookie });
  const sid = (setCookie: string) => /fx_sid=([^;]+)/.exec(setCookie)?.[1] ?? '';

  it('runs the whole flow and the canary password appears nowhere', async () => {
    expect((await login(WRONG)).status).toBe(401);
    const ok = await login(CANARY);
    expect(ok.status).toBe(200);
    const cookie = `fx_sid=${sid(ok.cookie)}`;
    expect((await req('GET', '/auth/me', { cookie })).text).toBe('{"email":"alice@e2e.example"}');
    expect((await req('GET', '/mailboxes', { cookie })).status).toBe(200);
    const leaky = await req('GET', '/messages/m1.SU5CT1g.1.1', { cookie });
    expect(leaky.status).toBe(500);
    expect(JSON.parse(leaky.text).error.code).toBe('internal_error');
    expect((await req('POST', '/auth/logout', { cookie })).status).toBe(204);

    const valkeyDump: string[] = [];
    for (const k of await redis.keys('*')) valkeyDump.push(k, String((await redis.type(k)) === 'string' ? await redis.get(k) : await redis.smembers(k)));
    const audit = await t.owner.selectFrom('audit_events').select(['event_type', 'actor', 'details']).execute();
    expect(audit.map((a) => a.event_type)).toEqual(expect.arrayContaining(['auth.login_failed', 'auth.login', 'auth.logout']));

    const everything = [...logs, ...captured, ...valkeyDump, JSON.stringify(audit)].join('\n');
    for (const secret of [CANARY, CANARY_B64, WRONG, Buffer.from(WRONG).toString('base64')]) {
      expect(everything.includes(secret), `leaked ${secret.slice(0, 8)}…`).toBe(false);
    }
    expect(logs.join('\n')).not.toMatch(/LOGIN alice|AUTH PLAIN|535 5\.7\.8/);
  });

  it('sets HttpOnly SameSite=Strict cookies and issues a new session id at every login', async () => {
    const a = await login(CANARY);
    expect(a.cookie).toMatch(/HttpOnly/i);
    expect(a.cookie).toMatch(/SameSite=Strict/i);
    expect(sid(a.cookie)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const b = await login(CANARY, `fx_sid=${sid(a.cookie)}`);
    expect(sid(b.cookie)).not.toBe(sid(a.cookie));
    // The session the browser had before is gone (no fixation, D13).
    expect((await req('GET', '/auth/me', { cookie: `fx_sid=${sid(a.cookie)}` })).status).toBe(401);
    expect((await req('GET', '/auth/me', { cookie: `fx_sid=${sid(b.cookie)}` })).status).toBe(200);
  });

  it('refuses cross-site and header-less state-changing requests (CSRF)', async () => {
    const cookie = `fx_sid=${sid((await login(CANARY)).cookie)}`;
    const send = { to: ['bob@e2e.example'], subject: 'x', text: 'x' };
    expect((await req('POST', '/messages/send', { cookie, body: send, csrf: false })).status).toBe(403);
    expect((await req('POST', '/messages/send', { cookie, body: send, headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await req('POST', '/auth/login', { body: { email: 'alice@e2e.example', password: CANARY }, csrf: false })).status).toBe(401);
    expect((await req('POST', '/messages/send', { cookie, body: send })).status).toBe(202);
  });

  it('gives the same answer for an unknown domain and a wrong password', async () => {
    const a = await req('POST', '/auth/login', { body: { email: 'x@unmapped.example', password: 'p' } });
    const b = await login(WRONG);
    expect(a.status).toBe(b.status);
    expect(JSON.parse(a.text).error.message).toBe(JSON.parse(b.text).error.message);
  });
});

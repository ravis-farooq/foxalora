import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Logger, type INestApplication, type LoggerService } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, hasPg, type TestDatabase } from './helpers/pg';

const VALKEY = process.env.FOXALORA_TEST_VALKEY_URL ?? '';
const TOKEN = randomBytes(32).toString('base64url');
const ADMIN_PASSWORD = `Admin-${randomBytes(8).toString('hex')}`;

const setupBody = (domains = ['hostco.example', 'client.example']) => ({
  organisation: 'HostCo',
  admin: { email: 'owner@hostco.example', password: ADMIN_PASSWORD },
  server: { imapHost: 'mail.hostco.example', imapPort: 993, imapTls: 'tls', smtpHost: 'mail.hostco.example', smtpPort: 587, smtpTls: 'starttls' },
  domains,
});

/** One Nest app per database, with the setup token configured. */
async function startApp(t: TestDatabase, logs: string[]) {
  const valkeyUrl = new URL(VALKEY);
  valkeyUrl.pathname = '/12';
  Object.assign(process.env, {
    DATABASE_URL: t.appUrl,
    VALKEY_URL: valkeyUrl.toString(),
    FOXALORA_VAULT_KEYS: `setup:${randomBytes(32).toString('base64')}`,
    FOXALORA_SETUP_TOKEN: TOKEN,
  });
  const logger: LoggerService = {
    log: (m) => logs.push(String(m)), error: (m, ...r) => logs.push([m, ...r].map(String).join(' ')),
    warn: (m) => logs.push(String(m)), debug: (m) => logs.push(String(m)), verbose: (m) => logs.push(String(m)),
  };
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/http');
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ bodyParser: false, logger });
  Logger.overrideLogger(logger);
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1/setup` };
}

function client(base: string, captured: string[]) {
  return async (method: string, path: string, opts: { body?: unknown; token?: string | null; csrf?: boolean } = {}) => {
    const token = opts.token === undefined ? TOKEN : opts.token;
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(opts.csrf === false ? {} : { 'X-Requested-With': 'foxalora' }),
        ...(token ? { 'X-Setup-Token': token } : {}),
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    captured.push(text);
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
}

describe.skipIf(!hasPg || !VALKEY)('setup wizard (FOX-099, FOX-100)', () => {
  let t: TestDatabase;
  let app: INestApplication;
  let req: ReturnType<typeof client>;
  const logs: string[] = [];
  const captured: string[] = [];

  beforeAll(async () => {
    t = await createTestDatabase();
    const started = await startApp(t, logs);
    app = started.app;
    req = client(started.base, captured);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.FOXALORA_SETUP_TOKEN;
    await t?.drop();
  });

  it('is invisible without the right token, or without the CSRF header on writes', async () => {
    expect((await req('GET', '/checks', { token: null })).status).toBe(404);
    expect((await req('GET', '/checks', { token: `${TOKEN}x` })).status).toBe(404);
    expect((await req('GET', '/checks', { token: 'short' })).status).toBe(404);
    expect((await req('POST', '/complete', { body: setupBody(), csrf: false })).status).toBe(404);
    expect((await req('POST', '/test-server', { body: { server: setupBody().server }, token: null })).status).toBe(404);
  });

  it('reports environment checks', async () => {
    const r = await req('GET', '/checks');
    expect(r.status).toBe(200);
    const ids = r.json.checks.map((c: { id: string }) => c.id);
    expect(ids).toEqual(['https', 'database', 'valkey', 'vault', 'mode', 'host']);
    expect(r.json.checks.find((c: { id: string }) => c.id === 'valkey').status).toBe('ok');
    expect(r.json.checks.find((c: { id: string }) => c.id === 'https').status).toBe('warn'); // plain HTTP, not production
  });

  it('keeps the SSRF guard on the connection test, and validates the server', async () => {
    const r = await req('POST', '/test-server', {
      body: { server: { imapHost: '127.0.0.1', imapPort: 993, imapTls: 'tls', smtpHost: '169.254.169.254', smtpPort: 465, smtpTls: 'tls' }, mailbox: { email: 'x@hostco.example', password: 'not-stored-123' } },
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ imap: { ok: false, reason: 'SSRF_BLOCKED' }, smtp: { ok: false, reason: 'SSRF_BLOCKED' }, loginTested: true });
    expect((await req('POST', '/test-server', { body: { server: { ...setupBody().server, imapPort: 25 } } })).status).toBe(400);
  });

  it('rejects weak or incomplete input without creating anything', async () => {
    const weak = setupBody();
    weak.admin.password = 'short';
    const r = await req('POST', '/complete', { body: weak });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/12 characters/);
    expect(await t.owner.selectFrom('admin_users').select('id').execute()).toEqual([]);
  });

  it('creates tenant, owner, server, domains and audit in one go, then locks itself', async () => {
    const r = await req('POST', '/complete', { body: setupBody() });
    expect(r.status).toBe(200);

    const admins = await t.owner.selectFrom('admin_users').selectAll().execute();
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ email: 'owner@hostco.example', role: 'owner' });
    expect(admins[0].password_hash).toMatch(/^scrypt\$/);
    const tenants = await t.owner.selectFrom('tenants').selectAll().execute();
    expect(tenants.map((x) => x.name)).toEqual(['HostCo']);
    expect(admins[0].tenant_id).toBe(tenants[0].id);
    const servers = await t.owner.selectFrom('mail_servers').selectAll().execute();
    expect(servers).toMatchObject([{ tenant_id: tenants[0].id, name: 'mail.hostco.example', imap_port: 993, smtp_tls: 'starttls', allow_private: false }]);
    const domains = await t.owner.selectFrom('domain_mappings').select(['domain', 'tenant_id']).orderBy('domain').execute();
    expect(domains).toEqual([{ domain: 'client.example', tenant_id: tenants[0].id }, { domain: 'hostco.example', tenant_id: tenants[0].id }]);
    const audit = await t.owner.selectFrom('audit_events').select(['event_type', 'actor', 'details']).execute();
    expect(audit.map((a) => a.event_type)).toEqual(expect.arrayContaining(['setup.completed', 'registry.server_created', 'registry.domain_mapped']));

    // FOX-100: from now on the wizard does not exist, token or not.
    expect((await req('GET', '/checks')).status).toBe(404);
    expect((await req('POST', '/test-server', { body: { server: setupBody().server } })).status).toBe(404);
    expect((await req('POST', '/complete', { body: setupBody(['other.example']) })).status).toBe(404);
    expect(await t.owner.selectFrom('admin_users').select('id').execute()).toHaveLength(1);

    // The admin password and the test mailbox password appear nowhere.
    const dump = JSON.stringify([admins, audit, logs, captured]);
    for (const secret of [ADMIN_PASSWORD, 'not-stored-123', TOKEN]) expect(dump.includes(secret), `leaked ${secret.slice(0, 6)}…`).toBe(false);
  });
});

describe.skipIf(!hasPg || !VALKEY)('setup wizard: all or nothing', () => {
  let t: TestDatabase;
  let app: INestApplication;
  let req: ReturnType<typeof client>;

  beforeAll(async () => {
    t = await createTestDatabase();
    // An install configured earlier with the CLI: one tenant, one mapped domain.
    const tenant = await t.owner.insertInto('tenants').values({ name: 'Default' }).returning('id').executeTakeFirstOrThrow();
    const s = await t.owner.insertInto('mail_servers').values({
      tenant_id: tenant.id, name: 'old', imap_host: 'old.example', imap_port: 993, imap_tls: 'tls', smtp_host: 'old.example', smtp_port: 465, smtp_tls: 'tls', allow_private: false,
    }).returning('id').executeTakeFirstOrThrow();
    await t.owner.insertInto('domain_mappings').values({ tenant_id: tenant.id, domain: 'taken.example', mail_server_id: s.id }).execute();
    const started = await startApp(t, []);
    app = started.app;
    req = client(started.base, []);
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.FOXALORA_SETUP_TOKEN;
    await t?.drop();
  });

  it('rolls back the tenant rename, admin and server when a domain conflicts', async () => {
    const r = await req('POST', '/complete', { body: setupBody(['fresh.example', 'taken.example']) });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toMatch(/already mapped/);
    expect(await t.owner.selectFrom('admin_users').select('id').execute()).toEqual([]);
    expect((await t.owner.selectFrom('tenants').select('name').execute()).map((x) => x.name)).toEqual(['Default']);
    expect(await t.owner.selectFrom('mail_servers').select('name').execute()).toEqual([{ name: 'old' }]);
    expect((await req('GET', '/checks')).status).toBe(200); // still open
  });

  it('adopts the single existing tenant, and only one of two simultaneous finishes wins', async () => {
    const [a, b] = await Promise.all([req('POST', '/complete', { body: setupBody(['fresh.example']) }), req('POST', '/complete', { body: setupBody(['fresh2.example']) })]);
    expect([a.status, b.status].sort()).toEqual([200, 404]);
    const tenants = await t.owner.selectFrom('tenants').select(['id', 'name']).execute();
    expect(tenants.map((x) => x.name)).toEqual(['HostCo']);
    expect(await t.owner.selectFrom('admin_users').select('tenant_id').execute()).toEqual([{ tenant_id: tenants[0].id }]);
  });
});

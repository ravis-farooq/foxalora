import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../src/mail/mail.service';
import { createTestDatabase, hasPg, type TestDatabase } from './helpers/pg';

const VALKEY = process.env.FOXALORA_TEST_VALKEY_URL ?? '';
const PASSWORD = `pw-${randomBytes(6).toString('hex')}`;

/** Accepts every mailbox with PASSWORD and records what would be sent. */
class FakeMail {
  sent: { fromName?: string }[] = [];
  async verifyLogin({ password }: { password: string }) {
    if (password !== PASSWORD) throw Object.assign(new Error('auth failed'), { code: 'EAUTH' });
  }
  async send(_c: unknown, _m: unknown, fromName?: string) {
    this.sent.push({ fromName });
  }
}

describe.skipIf(!hasPg || !VALKEY)('contacts, preferences and signatures over HTTP (FOX-072, FOX-076, FOX-077, FOX-079)', () => {
  let t: TestDatabase;
  let app: INestApplication;
  let base: string;
  let redis: Redis;
  const mail = new FakeMail();
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestDatabase();
    const tenant = async (name: string, domain: string) => {
      const tn = await t.owner.insertInto('tenants').values({ name }).returning('id').executeTakeFirstOrThrow();
      const s = await t.owner.insertInto('mail_servers').values({
        tenant_id: tn.id, name: 'm', imap_host: `mail.${domain}`, imap_port: 993, imap_tls: 'tls',
        smtp_host: `mail.${domain}`, smtp_port: 587, smtp_tls: 'starttls', allow_private: false,
      }).returning('id').executeTakeFirstOrThrow();
      await t.owner.insertInto('domain_mappings').values({ tenant_id: tn.id, domain, mail_server_id: s.id }).execute();
      return tn.id;
    };
    await tenant('A', 'a.example');
    await tenant('B', 'b.example');

    const valkeyUrl = new URL(VALKEY);
    valkeyUrl.pathname = '/12';
    Object.assign(process.env, {
      DATABASE_URL: t.appUrl,
      VALKEY_URL: valkeyUrl.toString(),
      FOXALORA_VAULT_KEYS: `e2e:${randomBytes(32).toString('base64')}`,
      LOGIN_MIN_FAILURE_MS: '0',
    });
    redis = new Redis(valkeyUrl.toString());
    await redis.flushdb();

    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/http');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(MailService).useValue(mail).compile();
    app = mod.createNestApplication({ bodyParser: false, logger: false });
    Logger.overrideLogger(false);
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/api/v1`;

    for (const who of ['alice@a.example', 'adam@a.example', 'bob@b.example']) {
      const res = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'X-Requested-With': 'foxalora', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: who, password: PASSWORD }),
      });
      expect(res.status).toBe(200);
      cookies[who] = `fx_sid=${/fx_sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]}`;
    }
  });

  afterAll(async () => {
    await app?.close();
    await redis?.flushdb();
    redis?.disconnect();
    await t?.drop();
  });

  const as = (who: string) => async (method: string, path: string, body?: unknown, extra: { csrf?: boolean } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Cookie: cookies[who],
        ...(extra.csrf === false ? {} : { 'X-Requested-With': 'foxalora' }),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* vCard or empty */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const alice = as('alice@a.example');
  const adam = as('adam@a.example');
  const bob = as('bob@b.example');

  it('creates, finds, updates and deletes a contact', async () => {
    const created = await alice('POST', '/contacts', { displayName: 'Dave Lee', company: 'Example', emails: [{ email: 'dave@x.test', label: 'work' }] });
    expect(created.status).toBe(201);
    const id = created.json.id;
    expect((await alice('GET', '/contacts?q=dave')).json.items.map((c: any) => c.id)).toEqual([id]);
    expect((await alice('GET', '/contacts?q=example')).json.total).toBe(1);
    expect((await alice('GET', '/contacts?q=nobody')).json.total).toBe(0);
    // LIKE wildcards in the search are taken literally.
    expect((await alice('GET', '/contacts?q=%25')).json.total).toBe(0);
    const updated = await alice('PUT', `/contacts/${id}`, { displayName: 'Dave Lee', phone: '+1 555', emails: ['dave@x.test', 'dl@y.test'] });
    expect(updated.status).toBe(200);
    expect(updated.json.emails.map((e: any) => e.email)).toEqual(['dave@x.test', 'dl@y.test']);
    expect((await alice('DELETE', `/contacts/${id}`)).status).toBe(204);
    expect((await alice('GET', `/contacts/${id}`)).status).toBe(404);
  });

  it('keeps contacts apart between mailboxes and tenants, whatever the request says', async () => {
    const c = await alice('POST', '/contacts', { displayName: 'Private', emails: ['private@x.test'], tenantId: 'x', mailbox: 'adam@a.example' });
    const id = c.json.id;
    for (const other of [adam, bob]) {
      expect((await other('GET', '/contacts')).json.total).toBe(0);
      expect((await other('GET', '/contacts/suggest?q=priv')).json).toEqual([]);
      expect((await other('GET', `/contacts/${id}`)).status).toBe(404);
      expect((await other('PUT', `/contacts/${id}`, { displayName: 'Hijacked' })).status).toBe(404);
      expect((await other('DELETE', `/contacts/${id}`)).status).toBe(404);
      expect((await other('GET', `/contacts/export?ids=${id}`)).text).not.toContain('Private');
    }
    expect((await alice('GET', `/contacts/${id}`)).json.displayName).toBe('Private');
    expect((await alice('GET', '/contacts/suggest?q=priv')).json).toEqual([{ name: 'Private', email: 'private@x.test' }]);
  });

  it('refuses invalid contacts, bad ids and requests without the CSRF header', async () => {
    expect((await alice('POST', '/contacts', { emails: ['not an address'] })).status).toBe(400);
    expect((await alice('POST', '/contacts', { displayName: 'A\r\nB' })).status).toBe(400);
    expect((await alice('GET', '/contacts/not-a-uuid')).status).toBe(404);
    expect((await alice('POST', '/contacts', { displayName: 'x' }, { csrf: false })).status).toBe(403);
    expect((await alice('GET', `/contacts/suggest?q=${'x'.repeat(101)}`)).status).toBe(400);
  });

  it('imports and exports vCards, skipping duplicates by address', async () => {
    const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:Erin Doe\nEMAIL;TYPE=WORK:erin@x.test\nEND:VCARD\nBEGIN:VCARD\nFN:Again\nEMAIL:PRIVATE@x.test\nEND:VCARD\nBEGIN:VCARD\nFN:Broken\nEMAIL:nope\nEND:VCARD\n';
    const r = await alice('POST', '/contacts/import', { vcard: vcf, duplicates: 'skip' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ imported: 1, skipped: 1, errors: [expect.stringMatching(/^Contact 3/)] });
    const out = await alice('GET', '/contacts/export');
    expect(out.headers.get('content-type')).toMatch(/^text\/vcard/);
    expect(out.headers.get('content-disposition')).toMatch(/^attachment; filename="contacts\.vcf"/);
    expect(out.headers.get('x-content-type-options')).toBe('nosniff');
    expect(out.text).toContain('FN:Erin Doe');
    expect(out.text).toContain('FN:Private');
    expect((await adam('GET', '/contacts/export')).text).toBe('');
  });

  it('stores preferences per mailbox, validates them and uses the display name when sending', async () => {
    expect((await alice('GET', '/preferences')).json).toEqual({ displayName: '', theme: 'system', density: 'comfortable', timeZone: 'auto' });
    expect((await alice('PATCH', '/preferences', { displayName: 'Alice A', theme: 'dark' })).json.theme).toBe('dark');
    expect((await alice('PATCH', '/preferences', { theme: 'pink' })).status).toBe(400);
    expect((await alice('PATCH', '/preferences', { isAdmin: true })).status).toBe(400);
    expect((await alice('PATCH', '/preferences', { displayName: 'Bank <support@bank.example>' })).status).toBe(400);
    expect((await adam('GET', '/preferences')).json.theme).toBe('system');

    expect((await alice('POST', '/messages/send', { to: ['x@y.test'], subject: 'Hi', text: 'Hi' })).status).toBe(202);
    expect(mail.sent.at(-1)).toEqual({ fromName: 'Alice A' });

    expect((await alice('DELETE', '/preferences')).status).toBe(204);
    expect((await alice('GET', '/preferences')).json.displayName).toBe('');
  });

  it('cleans signatures on save, keeps one default and keeps them per mailbox', async () => {
    const doc = (text: string, href?: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text, ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) }] }] });
    const a = await alice('POST', '/signatures', { name: 'Work', content: doc('Alice', 'javascript:alert(1)'), isDefault: true });
    expect(a.status).toBe(201);
    expect(JSON.stringify(a.json.content)).not.toContain('javascript');
    const b = await alice('POST', '/signatures', { name: 'Short', content: doc('A.'), isDefault: true });
    const list = (await alice('GET', '/signatures')).json;
    expect(list.map((s: any) => [s.name, s.isDefault])).toEqual([['Short', true], ['Work', false]]);
    expect((await adam('GET', '/signatures')).json).toEqual([]);
    expect((await adam('PUT', `/signatures/${a.json.id}`, { name: 'Mine', content: doc('x') })).status).toBe(404);
    expect((await adam('DELETE', `/signatures/${b.json.id}`)).status).toBe(404);
    expect((await alice('PUT', `/signatures/${a.json.id}`, { name: 'Work 2', content: doc('Alice'), isDefault: true })).json.isDefault).toBe(true);
    expect((await alice('GET', '/signatures')).json.filter((s: any) => s.isDefault).map((s: any) => s.name)).toEqual(['Work 2']);
    expect((await alice('DELETE', `/signatures/${b.json.id}`)).status).toBe(204);
  });
});

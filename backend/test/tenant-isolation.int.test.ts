import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateToLatest } from '../src/database/database';
import { TenantContextError, TenantDb } from '../src/database/tenant-db';
import { createTestDatabase, hasPg, type TestDatabase } from './helpers/pg';

describe.skipIf(!hasPg)('tenant isolation (PostgreSQL row-level security)', () => {
  let t: TestDatabase;
  let tdb: TenantDb;
  let A: string, B: string, serverA: string, serverB: string, suspended: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    tdb = new TenantDb(t.app);
    // Seed with the owner connection (not subject to RLS), like the operator CLI does.
    const ins = async (name: string, status: 'active' | 'suspended' = 'active') =>
      (await t.owner.insertInto('tenants').values({ name, status }).returning('id').executeTakeFirstOrThrow()).id;
    A = await ins('Tenant A');
    B = await ins('Tenant B');
    suspended = await ins('Suspended', 'suspended');
    const server = async (tenant_id: string, name: string) =>
      (await t.owner.insertInto('mail_servers').values({
        tenant_id, name, imap_host: `${name}.example.net`, imap_port: 993, imap_tls: 'tls',
        smtp_host: `${name}.example.net`, smtp_port: 587, smtp_tls: 'starttls', allow_private: false,
      }).returning('id').executeTakeFirstOrThrow()).id;
    serverA = await server(A, 'mail-a');
    serverB = await server(B, 'mail-b');
    const serverS = await server(suspended, 'mail-s');
    await t.owner.insertInto('domain_mappings').values([
      { tenant_id: A, domain: 'a.example', mail_server_id: serverA },
      { tenant_id: B, domain: 'b.example', mail_server_id: serverB },
      { tenant_id: suspended, domain: 'suspended.example', mail_server_id: serverS },
    ]).execute();
    for (const [tenant_id, mailbox] of [[A, 'alice@a.example'], [A, 'adam@a.example'], [B, 'bob@b.example']]) {
      const c = await t.owner.insertInto('contacts').values({ tenant_id, mailbox, display_name: `contact of ${mailbox}` }).returning('id').executeTakeFirstOrThrow();
      await t.owner.insertInto('contact_addresses').values({ tenant_id, mailbox, contact_id: c.id, email: `friend-of-${mailbox}` }).execute();
    }
  }, 60_000);

  afterAll(async () => {
    await t?.drop();
  });

  it('migrations are idempotent on an already migrated database', async () => {
    const again = await migrateToLatest(t.owner);
    expect(again.error).toBeUndefined();
    expect(again.results).toEqual([]);
  });

  it('runtime role is not superuser, cannot bypass RLS and owns no tables', async () => {
    const role = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`.execute(t.app);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    const owned = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`.execute(t.app);
    expect(owned.rows[0].n).toBe(0);
  });

  it('every tenant table has row-level security enabled', async () => {
    const r = await sql<{ relname: string; relrowsecurity: boolean }>`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'kysely_migration' AND c.relname <> 'kysely_migration_lock'`.execute(t.app);
    expect(r.rows.length).toBeGreaterThanOrEqual(9);
    for (const row of r.rows) expect(row.relrowsecurity, row.relname).toBe(true);
  });

  it('a query without tenant context returns no rows', async () => {
    for (const table of ['tenants', 'mail_servers', 'domain_mappings', 'contacts', 'contact_addresses'] as const) {
      const rows = await t.app.selectFrom(table).selectAll().execute();
      expect(rows, table).toEqual([]);
    }
  });

  it('TenantDb refuses calls without a valid tenant id', async () => {
    for (const bad of [undefined, '', 'not-a-uuid', "x' OR 1=1 --"]) {
      await expect(tdb.run({ tenantId: bad as never }, async () => 1)).rejects.toBeInstanceOf(TenantContextError);
    }
  });

  it('a tenant sees only its own servers, domains and tenant row', async () => {
    await tdb.run({ tenantId: A }, async (trx) => {
      expect((await trx.selectFrom('mail_servers').select('id').execute()).map((r) => r.id)).toEqual([serverA]);
      expect((await trx.selectFrom('domain_mappings').select('domain').execute()).map((r) => r.domain)).toEqual(['a.example']);
      expect((await trx.selectFrom('tenants').select('id').execute()).map((r) => r.id)).toEqual([A]);
    });
  });

  it('a tenant cannot insert rows for another tenant', async () => {
    await expect(
      tdb.run({ tenantId: A }, (trx) =>
        trx.insertInto('mail_servers').values({
          tenant_id: B, name: 'evil', imap_host: 'x.example', imap_port: 993, imap_tls: 'tls',
          smtp_host: 'x.example', smtp_port: 465, smtp_tls: 'tls', allow_private: false,
        }).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it('a tenant cannot update, delete or re-home another tenant\'s rows', async () => {
    await tdb.run({ tenantId: A }, async (trx) => {
      const upd = await trx.updateTable('mail_servers').set({ imap_host: 'hijack.example' }).where('id', '=', serverB).executeTakeFirst();
      expect(Number(upd.numUpdatedRows)).toBe(0);
      const del = await trx.deleteFrom('domain_mappings').where('domain', '=', 'b.example').executeTakeFirst();
      expect(Number(del.numDeletedRows)).toBe(0);
    });
    await expect(
      tdb.run({ tenantId: A }, (trx) => trx.updateTable('mail_servers').set({ tenant_id: B }).where('id', '=', serverA).execute()),
    ).rejects.toThrow(/row-level security/);
    const b = await tdb.run({ tenantId: B }, (trx) => trx.selectFrom('mail_servers').select('imap_host').executeTakeFirstOrThrow());
    expect(b.imap_host).toBe('mail-b.example.net');
  });

  it('a domain cannot be mapped to another tenant\'s server, and domains are globally unique', async () => {
    await expect(
      tdb.run({ tenantId: A }, (trx) => trx.insertInto('domain_mappings').values({ tenant_id: A, domain: 'steal.example', mail_server_id: serverB }).execute()),
    ).rejects.toThrow(/foreign key/);
    await expect(
      tdb.run({ tenantId: A }, (trx) => trx.insertInto('domain_mappings').values({ tenant_id: A, domain: 'b.example', mail_server_id: serverA }).execute()),
    ).rejects.toThrow(/duplicate key|unique/);
  });

  it('mailbox data is isolated between mailboxes of the same tenant and across tenants', async () => {
    const seen = (tenantId: string, mailbox: string) =>
      tdb.run({ tenantId, mailbox }, async (trx) => ({
        contacts: (await trx.selectFrom('contacts').select('display_name').execute()).map((r) => r.display_name),
        addresses: (await trx.selectFrom('contact_addresses').select('email').execute()).map((r) => r.email),
      }));
    expect(await seen(A, 'alice@a.example')).toEqual({ contacts: ['contact of alice@a.example'], addresses: ['friend-of-alice@a.example'] });
    expect(await seen(A, 'adam@a.example')).toEqual({ contacts: ['contact of adam@a.example'], addresses: ['friend-of-adam@a.example'] });
    expect(await seen(B, 'alice@a.example')).toEqual({ contacts: [], addresses: [] });
    expect(await seen(A, '')).toEqual({ contacts: [], addresses: [] });
    await expect(
      tdb.run({ tenantId: A, mailbox: 'alice@a.example' }, (trx) =>
        trx.insertInto('contacts').values({ tenant_id: A, mailbox: 'adam@a.example', display_name: 'planted' }).execute()),
    ).rejects.toThrow(/row-level security/);
  });

  it('audit events are insert-only for the runtime role', async () => {
    await tdb.run({ tenantId: A }, (trx) =>
      trx.insertInto('audit_events').values({ tenant_id: A, event_type: 'test.event', actor: 'system', details: '{}' }).execute());
    await expect(tdb.run({ tenantId: A }, (trx) => sql`UPDATE audit_events SET actor = 'x'`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(tdb.run({ tenantId: A }, (trx) => sql`DELETE FROM audit_events`.execute(trx))).rejects.toThrow(/permission denied/);
    await expect(tdb.run({ tenantId: A }, (trx) => sql`INSERT INTO tenants (name) VALUES ('rogue')`.execute(trx))).rejects.toThrow(/permission denied/);
  });

  it('tenant context does not leak to the next query on a pooled connection', async () => {
    await tdb.run({ tenantId: A }, async () => undefined);
    for (let i = 0; i < 8; i++) {
      const r = await sql<{ t: string | null }>`SELECT current_setting('app.tenant_id', true) AS t`.execute(t.app);
      expect(r.rows[0].t ?? '').toBe('');
    }
  });

  it('login resolution works before tenant context, and only for active tenants', async () => {
    const r = await sql<{ tenant_id: string; mail_server_id: string; imap_tls: string; smtp_tls: string }>`
      SELECT * FROM resolve_mail_domain(${'A.EXAMPLE'})`.execute(t.app);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ tenant_id: A, mail_server_id: serverA, imap_tls: 'tls', smtp_tls: 'starttls' });
    expect((await sql`SELECT * FROM resolve_mail_domain(${'suspended.example'})`.execute(t.app)).rows).toEqual([]);
    expect((await sql`SELECT * FROM resolve_mail_domain(${'unknown.example'})`.execute(t.app)).rows).toEqual([]);
  });
});

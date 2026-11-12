import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { createDb, migrateToLatest } from '../../src/database/database';
import type { Database } from '../../src/database/schema';

/**
 * Integration tests need PostgreSQL. Set FOXALORA_TEST_PG_OWNER_URL to a superuser /
 * owner connection, e.g. postgres://foxalora:foxalora-dev-owner@127.0.0.1:5432/foxalora
 * (CI sets it). Each run gets its own throwaway database.
 */
export const PG_OWNER_URL = process.env.FOXALORA_TEST_PG_OWNER_URL ?? '';
export const hasPg = PG_OWNER_URL !== '';
if (!hasPg) {
  // CI must never silently skip the isolation suite.
  if (process.env.FOXALORA_REQUIRE_INTEGRATION_TESTS) throw new Error('FOXALORA_TEST_PG_OWNER_URL is required in CI');
  console.warn('FOXALORA_TEST_PG_OWNER_URL not set: database integration tests are SKIPPED');
}

const APP_PASSWORD = process.env.FOXALORA_TEST_PG_APP_PASSWORD ?? 'foxalora-dev-app';

export interface TestDatabase {
  owner: Kysely<Database>;
  /** Connected as foxalora_app: the runtime role, always subject to RLS. */
  app: Kysely<Database>;
  name: string;
  appUrl: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, db: string, user?: string, password?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `fx_test_${randomBytes(6).toString('hex')}`;
  const admin = createDb(PG_OWNER_URL, 1);
  await sql`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foxalora_app') THEN
      CREATE ROLE foxalora_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF; END $$`.execute(admin);
  await sql`ALTER ROLE foxalora_app PASSWORD ${sql.lit(APP_PASSWORD)}`.execute(admin);
  await sql`CREATE DATABASE ${sql.id(name)}`.execute(admin);
  await sql`GRANT CONNECT ON DATABASE ${sql.id(name)} TO foxalora_app`.execute(admin);
  await admin.destroy();

  const owner = createDb(withDatabase(PG_OWNER_URL, name), 2);
  const result = await migrateToLatest(owner);
  if (result.error) throw result.error;
  const appUrl = withDatabase(PG_OWNER_URL, name, 'foxalora_app', APP_PASSWORD);
  const app = createDb(appUrl, 4);

  return {
    owner,
    app,
    name,
    appUrl,
    async drop() {
      await app.destroy();
      await owner.destroy();
      const a = createDb(PG_OWNER_URL, 1);
      await sql`DROP DATABASE IF EXISTS ${sql.id(name)} WITH (FORCE)`.execute(a);
      await a.destroy();
    },
  };
}

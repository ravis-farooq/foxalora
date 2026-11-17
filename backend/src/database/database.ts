import { Kysely, Migrator, PostgresDialect, type Migration, type MigrationResultSet } from 'kysely';
import { Pool } from 'pg';
import * as m0001 from './migrations/0001_initial';
import * as m0002 from './migrations/0002_contacts_order_and_default_signature';
import * as m0003 from './migrations/0003_recent_recipients';
import * as m0004 from './migrations/0004_server_saves_sent';
import * as m0005 from './migrations/0005_admin_users_and_setup';
import type { Database } from './schema';

/** Migrations are listed explicitly (no directory scanning in production images). */
const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': m0001,
  '0002_contacts_order_and_default_signature': m0002,
  '0003_recent_recipients': m0003,
  '0004_server_saves_sent': m0004,
  '0005_admin_users_and_setup': m0005,
};

export function createDb(connectionString: string, max = 10): Kysely<Database> {
  if (!connectionString) throw new Error('database connection string is required');
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString, max }) }),
  });
}

/** Runs pending migrations. Use the schema-owner connection, never the runtime role. */
export async function migrateToLatest<T>(db: Kysely<T>): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db: db as unknown as Kysely<unknown>, provider: { getMigrations: async () => MIGRATIONS } });
  return migrator.migrateToLatest();
}

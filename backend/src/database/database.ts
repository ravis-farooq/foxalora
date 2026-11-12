import { Kysely, Migrator, PostgresDialect, type Migration, type MigrationResultSet } from 'kysely';
import { Pool } from 'pg';
import * as m0001 from './migrations/0001_initial';
import type { Database } from './schema';

/** Migrations are listed explicitly (no directory scanning in production images). */
const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': m0001,
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

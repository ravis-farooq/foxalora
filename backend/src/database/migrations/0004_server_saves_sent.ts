import { Kysely, sql } from 'kysely';

/**
 * OPEN-4: Foxalora saves a copy of each sent message to the Sent folder, except on
 * servers that do it themselves (for example Gmail). The administrator marks those.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE mail_servers ADD COLUMN saves_sent boolean NOT NULL DEFAULT false`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE mail_servers DROP COLUMN IF EXISTS saves_sent`.execute(db);
}

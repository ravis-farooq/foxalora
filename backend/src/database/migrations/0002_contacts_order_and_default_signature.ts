import { Kysely, sql } from 'kysely';

/**
 * Contacts and signatures (FOX-072, FOX-079):
 * - contact_addresses.position keeps a contact's addresses in the order the user gave.
 * - At most one default signature per mailbox, enforced by the database.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE contact_addresses ADD COLUMN position smallint NOT NULL DEFAULT 0 CHECK (position BETWEEN 0 AND 99);
    CREATE INDEX contact_addresses_contact_idx ON contact_addresses (contact_id, position);
    CREATE UNIQUE INDEX signatures_one_default_idx ON signatures (tenant_id, mailbox) WHERE is_default;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS signatures_one_default_idx;
    DROP INDEX IF EXISTS contact_addresses_contact_idx;
    ALTER TABLE contact_addresses DROP COLUMN IF EXISTS position;
  `.execute(db);
}

import { Kysely, sql } from 'kysely';

/**
 * Addresses the user has written to (FOX-073 "frequently used addresses"), for recipient
 * suggestions. Only the address, a use count and the last use are kept: no names, subjects
 * or message content. Users can turn this off and clear it in Settings.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE recent_recipients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 320),
      email text NOT NULL CHECK (email = lower(email) AND length(email) <= 320),
      use_count integer NOT NULL DEFAULT 1 CHECK (use_count > 0),
      last_used timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, mailbox, email)
    );
    CREATE INDEX recent_recipients_owner_idx ON recent_recipients (tenant_id, mailbox, last_used DESC);
    ALTER TABLE recent_recipients ENABLE ROW LEVEL SECURITY;
    CREATE POLICY mailbox_isolation ON recent_recipients
      USING (tenant_id = app_tenant_id() AND mailbox = app_mailbox())
      WITH CHECK (tenant_id = app_tenant_id() AND mailbox = app_mailbox());
  `.execute(db);
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foxalora_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON recent_recipients TO foxalora_app;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS recent_recipients;`.execute(db);
}

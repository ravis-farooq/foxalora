import { Kysely, sql } from 'kysely';

/**
 * Initial schema (FOX-011) with row-level security (FOX-010).
 *
 * Tenant isolation: every tenant table has RLS keyed to the transaction-local
 * setting app.tenant_id. When it is not set, policies match nothing (fail closed).
 * Mailbox-owned tables also require app.mailbox to match.
 *
 * Roles: the migration role owns the tables and is NOT subject to RLS (RLS is
 * enabled, not forced). The runtime role foxalora_app does not own them, so RLS
 * always applies to it. The only cross-tenant path is resolve_mail_domain(), used
 * by login before the tenant is known.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
    CREATE FUNCTION app_mailbox() RETURNS text LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('app.mailbox', true), '') $$;

    CREATE TABLE tenants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE mail_servers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      imap_host text NOT NULL CHECK (length(imap_host) BETWEEN 1 AND 253),
      imap_port integer NOT NULL CHECK (imap_port BETWEEN 1 AND 65535),
      imap_tls text NOT NULL CHECK (imap_tls IN ('tls', 'starttls', 'none-dev-only')),
      smtp_host text NOT NULL CHECK (length(smtp_host) BETWEEN 1 AND 253),
      smtp_port integer NOT NULL CHECK (smtp_port BETWEEN 1 AND 65535),
      smtp_tls text NOT NULL CHECK (smtp_tls IN ('tls', 'starttls', 'none-dev-only')),
      allow_private boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, name),
      UNIQUE (id, tenant_id)
    );
    CREATE INDEX mail_servers_tenant_idx ON mail_servers (tenant_id);

    CREATE TABLE domain_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      domain text NOT NULL UNIQUE CHECK (
        domain = lower(domain)
        AND length(domain) <= 253
        AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
      ),
      mail_server_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      -- A mapping can only point at a server of the same tenant.
      FOREIGN KEY (mail_server_id, tenant_id) REFERENCES mail_servers (id, tenant_id) ON DELETE RESTRICT
    );
    CREATE INDEX domain_mappings_tenant_idx ON domain_mappings (tenant_id);

    CREATE TABLE user_preferences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 320),
      preferences jsonb NOT NULL DEFAULT '{}',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, mailbox)
    );

    CREATE TABLE signatures (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 320),
      name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      content jsonb NOT NULL,
      is_default boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX signatures_owner_idx ON signatures (tenant_id, mailbox);

    CREATE TABLE contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 320),
      display_name text NOT NULL DEFAULT '' CHECK (length(display_name) <= 200),
      company text NOT NULL DEFAULT '' CHECK (length(company) <= 200),
      phone text NOT NULL DEFAULT '' CHECK (length(phone) <= 50),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (id, tenant_id)
    );
    CREATE INDEX contacts_owner_idx ON contacts (tenant_id, mailbox);

    CREATE TABLE contact_addresses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      mailbox text NOT NULL CHECK (mailbox = lower(mailbox) AND length(mailbox) <= 320),
      contact_id uuid NOT NULL,
      email text NOT NULL CHECK (length(email) <= 320),
      label text NOT NULL DEFAULT '' CHECK (length(label) <= 50),
      FOREIGN KEY (contact_id, tenant_id) REFERENCES contacts (id, tenant_id) ON DELETE CASCADE
    );
    CREATE INDEX contact_addresses_lookup_idx ON contact_addresses (tenant_id, mailbox, email);

    CREATE TABLE system_settings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key text NOT NULL CHECK (key ~ '^[a-z0-9_.]{1,100}$'),
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, key)
    );

    -- Insert-only for the runtime role. prev_hash/hash are for the hash chain (FOX-140).
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      event_type text NOT NULL CHECK (event_type ~ '^[a-z0-9_.]{1,100}$'),
      actor text NOT NULL CHECK (length(actor) <= 320),
      details jsonb NOT NULL DEFAULT '{}',
      prev_hash bytea,
      hash bytea
    );
    CREATE INDEX audit_events_tenant_time_idx ON audit_events (tenant_id, occurred_at DESC);
  `.execute(db);

  // Row-level security.
  await sql`
    ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_self ON tenants USING (id = app_tenant_id());
  `.execute(db);
  for (const table of ['mail_servers', 'domain_mappings', 'system_settings', 'audit_events']) {
    await sql`
      ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON ${sql.table(table)}
        USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
    `.execute(db);
  }
  for (const table of ['user_preferences', 'signatures', 'contacts', 'contact_addresses']) {
    await sql`
      ALTER TABLE ${sql.table(table)} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY mailbox_isolation ON ${sql.table(table)}
        USING (tenant_id = app_tenant_id() AND mailbox = app_mailbox())
        WITH CHECK (tenant_id = app_tenant_id() AND mailbox = app_mailbox());
    `.execute(db);
  }

  // Login: domain -> tenant + server, before any tenant context exists.
  await sql`
    CREATE FUNCTION resolve_mail_domain(p_domain text)
    RETURNS TABLE (
      tenant_id uuid, mail_server_id uuid,
      imap_host text, imap_port integer, imap_tls text,
      smtp_host text, smtp_port integer, smtp_tls text, allow_private boolean
    )
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT d.tenant_id, s.id, s.imap_host, s.imap_port, s.imap_tls,
             s.smtp_host, s.smtp_port, s.smtp_tls, s.allow_private
        FROM domain_mappings d
        JOIN tenants t ON t.id = d.tenant_id AND t.status = 'active'
        JOIN mail_servers s ON s.id = d.mail_server_id AND s.tenant_id = d.tenant_id
       WHERE d.domain = lower(p_domain)
    $$;
    REVOKE ALL ON FUNCTION resolve_mail_domain(text) FROM PUBLIC;
  `.execute(db);

  // Least-privilege grants for the runtime role (created by the installer / dev init script).
  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foxalora_app') THEN
        REVOKE CREATE ON SCHEMA public FROM PUBLIC;
        GRANT USAGE ON SCHEMA public TO foxalora_app;
        GRANT SELECT ON tenants TO foxalora_app;
        GRANT SELECT, INSERT, UPDATE, DELETE ON mail_servers, domain_mappings, user_preferences,
          signatures, contacts, contact_addresses, system_settings TO foxalora_app;
        GRANT SELECT, INSERT ON audit_events TO foxalora_app;
        GRANT EXECUTE ON FUNCTION resolve_mail_domain(text), app_tenant_id(), app_mailbox() TO foxalora_app;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP FUNCTION IF EXISTS resolve_mail_domain(text);
    DROP TABLE IF EXISTS audit_events, system_settings, contact_addresses, contacts, signatures,
      user_preferences, domain_mappings, mail_servers, tenants;
    DROP FUNCTION IF EXISTS app_mailbox(), app_tenant_id();
  `.execute(db);
}

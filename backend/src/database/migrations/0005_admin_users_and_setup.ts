import { Kysely, sql } from 'kysely';

/**
 * Administrator accounts (FOX-081) and the first-run setup wizard (FOX-099, FOX-100).
 *
 * admin_users is tenant-scoped like every other table (row-level security). Two
 * SECURITY DEFINER functions are the only paths that look across tenants, and only
 * while no administrator exists:
 *   setup_is_open()    true until the first administrator is created
 *   setup_bootstrap()  creates (or reuses the single) tenant and the first administrator,
 *                      in the caller's transaction, and refuses once an administrator exists
 * The wizard therefore locks itself the moment it succeeds.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE admin_users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
      password_hash text NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
      role text NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
      -- FOX-134: TOTP secret, envelope-encrypted. Null until two-step verification is set up.
      totp_secret jsonb,
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX admin_users_tenant_idx ON admin_users (tenant_id);
    ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON admin_users
      USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());

    CREATE FUNCTION setup_is_open() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT NOT EXISTS (SELECT 1 FROM admin_users)
    $$;
    REVOKE ALL ON FUNCTION setup_is_open() FROM PUBLIC;

    CREATE FUNCTION setup_bootstrap(p_tenant_name text, p_admin_email text, p_password_hash text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      t uuid;
      n integer;
    BEGIN
      -- Two browsers finishing at the same moment: the second one waits, then sees the admin.
      PERFORM pg_advisory_xact_lock(727100);
      IF EXISTS (SELECT 1 FROM admin_users) THEN
        RAISE EXCEPTION 'setup already completed' USING ERRCODE = 'FX001';
      END IF;
      SELECT count(*) INTO n FROM tenants;
      IF n = 0 THEN
        INSERT INTO tenants (name) VALUES (p_tenant_name) RETURNING id INTO t;
      ELSIF n = 1 THEN
        -- An install configured earlier with the CLI: adopt its tenant.
        SELECT id INTO t FROM tenants;
        UPDATE tenants SET name = p_tenant_name, updated_at = now() WHERE id = t;
      ELSE
        RAISE EXCEPTION 'several tenants exist' USING ERRCODE = 'FX002';
      END IF;
      INSERT INTO admin_users (tenant_id, email, password_hash, role)
        VALUES (t, lower(p_admin_email), p_password_hash, 'owner');
      RETURN t;
    END
    $$;
    REVOKE ALL ON FUNCTION setup_bootstrap(text, text, text) FROM PUBLIC;
  `.execute(db);

  await sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'foxalora_app') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON admin_users TO foxalora_app;
        GRANT EXECUTE ON FUNCTION setup_is_open(), setup_bootstrap(text, text, text) TO foxalora_app;
      END IF;
    END $$;
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP FUNCTION IF EXISTS setup_bootstrap(text, text, text);
    DROP FUNCTION IF EXISTS setup_is_open();
    DROP TABLE IF EXISTS admin_users;
  `.execute(db);
}

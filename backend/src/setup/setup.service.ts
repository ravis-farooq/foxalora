import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { sql, type Kysely } from 'kysely';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { loginFailureReason } from '../auth/login-reason';
import { DB, VALKEY } from '../common/tokens';
import type { Database } from '../database/schema';
import { probeServer } from '../mail/connections';
import { RegistryService } from '../registry/registry.service';
import { isProduction, type ServerInput } from '../registry/server-validation';
import { SsrfError } from '../security/ssrf';
import { hashAdminPassword } from './admin-password';
import type { SetupInput } from './setup-input';

export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface SetupCheck { id: string; label: string; status: CheckStatus; detail: string }

export class SetupClosedError extends Error {}
export class SetupConflictError extends Error {}

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * First-run setup wizard (FOX-099) and its lock (FOX-100).
 *
 * Open only while (1) the operator started the API with FOXALORA_SETUP_TOKEN (written by
 * deploy/install.sh, so only someone with file-system access has it) and (2) no
 * administrator exists. Every endpoint answers 404 otherwise, including for a wrong token.
 */
@Injectable()
export class SetupService {
  private log = new Logger('Setup');

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly registry: RegistryService,
    private readonly audit: AuditService,
  ) {}

  private configuredToken(): string | null {
    const t = process.env.FOXALORA_SETUP_TOKEN ?? '';
    return t.length >= 32 ? t : null; // a short or missing token keeps setup closed
  }

  tokenMatches(given: unknown): boolean {
    const expected = this.configuredToken();
    if (!expected || typeof given !== 'string' || !given) return false;
    return timingSafeEqual(digest(given), digest(expected));
  }

  async isOpen(): Promise<boolean> {
    if (!this.configuredToken()) return false;
    const r = await sql<{ open: boolean }>`SELECT setup_is_open() AS open`.execute(this.db);
    return r.rows[0]?.open === true;
  }

  /** Roundcube-style environment check, step 1 of the wizard. */
  async checks(req: { protocol: string; hostname: string }): Promise<SetupCheck[]> {
    const prod = isProduction();
    const checks: SetupCheck[] = [];
    const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

    const https = req.protocol === 'https';
    add('https', 'Secure connection (HTTPS)', https ? 'ok' : prod ? 'fail' : 'warn',
      https ? 'This page was loaded over HTTPS.' : 'This page was not loaded over HTTPS. Customers would send passwords unencrypted.');

    // The status query that opened this page already reached the database.
    add('database', 'Database (PostgreSQL)', 'ok', 'Connected, schema up to date.');

    try {
      const pong = await this.valkey.ping();
      add('valkey', 'Session store (Valkey)', pong === 'PONG' ? 'ok' : 'fail', pong === 'PONG' ? 'Connected.' : 'Unexpected answer.');
    } catch {
      add('valkey', 'Session store (Valkey)', 'fail', 'Not reachable. Check the valkey container.');
    }

    // The API does not start without a valid vault key, so reaching this page proves it.
    add('vault', 'Session encryption key', 'ok', 'Configured.');

    add('mode', 'Production mode', prod ? 'ok' : 'warn',
      prod ? 'Unencrypted mail server connections are refused.' : 'Development mode: unencrypted test mail servers are allowed. Do not use for customers.');

    const hosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    add('host', 'Site address', hosts.length ? 'ok' : prod ? 'fail' : 'warn',
      hosts.length ? `Webmail answers only at ${hosts.join(', ')}.` : 'ALLOWED_HOSTS is not set, so any host name is accepted.');

    return checks;
  }

  /** "Test connection": reach IMAP and SMTP over TLS, optionally log in with a test mailbox. */
  async testServer(server: ServerInput, mailbox: { user: string; pass: string } | undefined) {
    const reasonOf = (e: unknown) => (e instanceof SsrfError ? 'SSRF_BLOCKED' : loginFailureReason(e));
    const result = await probeServer(server, mailbox, reasonOf);
    this.log.log(`connection test: imap ${result.imap.ok ? 'ok' : result.imap.reason}, smtp ${result.smtp.ok ? 'ok' : result.smtp.reason}`);
    return { ...result, loginTested: mailbox !== undefined };
  }

  /**
   * Writes everything in ONE transaction: tenant, first administrator, mail server, domains,
   * audit entries. Either all of it exists afterwards (and the wizard is locked) or none of it.
   */
  async complete(input: SetupInput, ip: string): Promise<void> {
    const hash = await hashAdminPassword(input.admin.password);
    const actor = `admin:${input.admin.email}`;
    try {
      await this.db.transaction().execute(async (trx) => {
        const r = await sql<{ id: string }>`SELECT setup_bootstrap(${input.organisation}, ${input.admin.email}, ${hash}) AS id`.execute(trx);
        const tenantId = r.rows[0].id;
        // From here on, row-level security applies as for any tenant request.
        await sql`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.mailbox', '', true)`.execute(trx);
        const server = await this.registry.insertServer(trx, tenantId, input.server, actor);
        for (const domain of input.domains) await this.registry.insertDomain(trx, tenantId, domain, { id: server.id, name: input.server.name }, actor);
        await this.audit.insert(trx, tenantId, 'setup.completed', actor, { ip, server: input.server.name, domains: input.domains.length });
      });
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      const constraint = String((e as { constraint?: unknown })?.constraint ?? '');
      if (code === 'FX001') throw new SetupClosedError();
      if (code === 'FX002') throw new SetupConflictError('This install already has several tenants. Create the administrator with the command line instead.');
      if (code === '23505' && constraint.startsWith('domain_mappings')) throw new SetupConflictError('One of these domains is already mapped to a mail server.');
      if (code === '23505' && constraint.startsWith('mail_servers')) throw new SetupConflictError('A mail server with this name already exists.');
      throw e;
    }
    this.log.log(`setup completed (${input.domains.length} domain(s)); the setup wizard is now locked`);
  }
}

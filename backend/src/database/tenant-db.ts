import { sql, type Kysely, type Transaction } from 'kysely';
import type { Database } from './schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantContext {
  /** Always taken from the authenticated session, never from the request. */
  tenantId: string;
  /** Set for mailbox-owned data (preferences, contacts, signatures). */
  mailbox?: string;
}

export class TenantContextError extends Error {}

/**
 * The only way the application reaches tenant data (FOX-009). Every call runs in a
 * transaction with app.tenant_id (and app.mailbox) set locally, so PostgreSQL
 * row-level security filters every query. Calls without a valid tenant are refused.
 */
export class TenantDb {
  constructor(private readonly db: Kysely<Database>) {}

  async run<T>(ctx: TenantContext, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    if (!ctx || typeof ctx.tenantId !== 'string' || !UUID.test(ctx.tenantId)) {
      throw new TenantContextError('tenant context required');
    }
    const mailbox = ctx.mailbox === undefined ? '' : String(ctx.mailbox).toLowerCase();
    if (mailbox.length > 320) throw new TenantContextError('invalid mailbox');

    return this.db.transaction().execute(async (trx) => {
      // set_config(..., true) is transaction-local: it cannot leak to the next request
      // that reuses this pooled connection.
      await sql`SELECT set_config('app.tenant_id', ${ctx.tenantId}, true), set_config('app.mailbox', ${mailbox}, true)`.execute(trx);
      return fn(trx);
    });
  }
}

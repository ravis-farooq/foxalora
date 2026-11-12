import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { EMAIL_RE } from '../common/email';
import { TenantDb } from '../database/tenant-db';
import { likePattern } from './contact-input';
import type { Owner } from './contacts.service';

export const MAX_RECENT = 500;

/** Addresses the mailbox has written to (FOX-073). Row-level security keeps them per mailbox. */
@Injectable()
export class RecipientsService {
  constructor(private readonly tdb: TenantDb) {}

  async record(o: Owner, addresses: string[]): Promise<void> {
    const me = o.email.toLowerCase();
    const emails = [...new Set(addresses.map((a) => a.trim().toLowerCase()))].filter((a) => a !== me && EMAIL_RE.test(a) && a.length <= 320);
    if (!emails.length) return;
    await this.tdb.run({ tenantId: o.tenantId, mailbox: o.email }, async (trx) => {
      await trx
        .insertInto('recent_recipients')
        .values(emails.map((email) => ({ tenant_id: o.tenantId, mailbox: me, email })))
        .onConflict((oc) => oc.columns(['tenant_id', 'mailbox', 'email']).doUpdateSet({ use_count: sql`recent_recipients.use_count + 1`, last_used: new Date() }))
        .execute();
      // Keep the most recent MAX_RECENT addresses only.
      await trx
        .deleteFrom('recent_recipients')
        .where('id', 'not in', (qb) => qb.selectFrom('recent_recipients').select('id').orderBy('last_used', 'desc').limit(MAX_RECENT))
        .execute();
    });
  }

  async suggest(o: Owner, term: string, limit: number): Promise<string[]> {
    if (!term) return [];
    const rows = await this.tdb.run({ tenantId: o.tenantId, mailbox: o.email }, (trx) =>
      trx
        .selectFrom('recent_recipients')
        .select('email')
        .where('email', 'ilike', likePattern(term))
        .orderBy('use_count', 'desc')
        .orderBy('last_used', 'desc')
        .limit(limit)
        .execute(),
    );
    return rows.map((r) => r.email);
  }

  async clear(o: Owner): Promise<void> {
    await this.tdb.run({ tenantId: o.tenantId, mailbox: o.email }, (trx) => trx.deleteFrom('recent_recipients').execute());
  }

}

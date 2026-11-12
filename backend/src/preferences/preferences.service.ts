import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { Owner } from '../contacts/contacts.service';
import { TenantDb, type TenantContext } from '../database/tenant-db';
import { parsePreferencesPatch, withDefaults, type Preferences } from './preferences';
import { MAX_SIGNATURES, parseSignatureInput } from './signature-content';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ctx = (o: Owner): TenantContext => ({ tenantId: o.tenantId, mailbox: o.email });

export interface SignatureView { id: string; name: string; content: unknown; isDefault: boolean }

/** Preferences (FOX-077) and signatures (FOX-079) of the signed-in mailbox, under row-level security. */
@Injectable()
export class PreferencesService {
  constructor(private readonly tdb: TenantDb) {}

  async get(o: Owner): Promise<Preferences> {
    const row = await this.tdb.run(ctx(o), (trx) => trx.selectFrom('user_preferences').select('preferences').executeTakeFirst());
    return withDefaults(row?.preferences);
  }

  async update(o: Owner, body: unknown): Promise<Preferences> {
    const patch = parsePreferencesPatch(body);
    return this.tdb.run(ctx(o), async (trx) => {
      const row = await trx.selectFrom('user_preferences').select('preferences').executeTakeFirst();
      const next = withDefaults({ ...withDefaults(row?.preferences), ...patch });
      await trx
        .insertInto('user_preferences')
        .values({ tenant_id: o.tenantId, mailbox: o.email.toLowerCase(), preferences: JSON.stringify(next) })
        .onConflict((oc) => oc.columns(['tenant_id', 'mailbox']).doUpdateSet({ preferences: JSON.stringify(next), updated_at: new Date() }))
        .execute();
      return next;
    });
  }

  /** Back to the defaults (admin defaults arrive with the console, E12). */
  async reset(o: Owner): Promise<void> {
    await this.tdb.run(ctx(o), (trx) => trx.deleteFrom('user_preferences').execute());
  }

  async listSignatures(o: Owner): Promise<SignatureView[]> {
    const rows = await this.tdb.run(ctx(o), (trx) =>
      trx.selectFrom('signatures').select(['id', 'name', 'content', 'is_default']).orderBy('is_default', 'desc').orderBy(sql`lower(name)`).execute(),
    );
    return rows.map((r) => ({ id: r.id, name: r.name, content: r.content, isDefault: r.is_default }));
  }

  async createSignature(o: Owner, body: unknown): Promise<SignatureView> {
    const s = parseSignatureInput(body);
    return this.tdb.run(ctx(o), async (trx) => {
      const { n } = await trx.selectFrom('signatures').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
      if (Number(n) >= MAX_SIGNATURES) throw new BadRequestException(`at most ${MAX_SIGNATURES} signatures`);
      if (s.isDefault) await trx.updateTable('signatures').set({ is_default: false }).where('is_default', '=', true).execute();
      const row = await trx
        .insertInto('signatures')
        .values({ tenant_id: o.tenantId, mailbox: o.email.toLowerCase(), name: s.name, content: JSON.stringify(s.content), is_default: s.isDefault })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: row.id, ...s };
    });
  }

  async updateSignature(o: Owner, id: string, body: unknown): Promise<SignatureView> {
    if (!UUID.test(id)) throw new NotFoundException();
    const s = parseSignatureInput(body);
    return this.tdb.run(ctx(o), async (trx) => {
      if (s.isDefault) await trx.updateTable('signatures').set({ is_default: false }).where('is_default', '=', true).where('id', '!=', id).execute();
      const row = await trx
        .updateTable('signatures')
        .set({ name: s.name, content: JSON.stringify(s.content), is_default: s.isDefault, updated_at: new Date() })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw new NotFoundException();
      return { id, ...s };
    });
  }

  async removeSignature(o: Owner, id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException();
    const r = await this.tdb.run(ctx(o), (trx) => trx.deleteFrom('signatures').where('id', '=', id).returning('id').executeTakeFirst());
    if (!r) throw new NotFoundException();
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { CONTROL_CHARS } from '../common/email';
import type { Database } from '../database/schema';
import { TenantDb, type TenantContext } from '../database/tenant-db';
import { likePattern, parseContactInput, type ContactInput } from './contact-input';
import { parseVCards, toVCard } from './vcard';

/** The signed-in mailbox; both values come from the session. */
export interface Owner { tenantId: string; email: string }

export interface ContactView extends ContactInput { id: string }

export const CONTACTS_PAGE_SIZE = 50;
export const MAX_CONTACTS = 10_000;
const SUGGESTIONS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ctx = (o: Owner): TenantContext => ({ tenantId: o.tenantId, mailbox: o.email });

function searchTerm(q: unknown): string {
  if (q === undefined) return '';
  if (typeof q !== 'string' || q.length > 100 || CONTROL_CHARS.test(q)) throw new BadRequestException('invalid search');
  return q.trim();
}

/**
 * Address book (FOX-072..075). Every query runs through TenantDb, so PostgreSQL row-level
 * security limits it to the signed-in mailbox (FOX-076); an id from another mailbox is
 * simply not found.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly tdb: TenantDb) {}

  async list(o: Owner, q?: unknown, page?: unknown): Promise<{ items: ContactView[]; total: number }> {
    const term = searchTerm(q);
    const p = Math.max(1, Math.floor(Number(page)) || 1);
    return this.tdb.run(ctx(o), async (trx) => {
      let base = trx.selectFrom('contacts');
      if (term) {
        const pat = likePattern(term);
        base = base.where((eb) =>
          eb.or([
            eb('display_name', 'ilike', pat),
            eb('company', 'ilike', pat),
            eb.exists(eb.selectFrom('contact_addresses as a').select('a.id').whereRef('a.contact_id', '=', 'contacts.id').where('a.email', 'ilike', pat)),
          ]),
        );
      }
      const { n } = await base.select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
      const rows = await base
        .select(['id', 'display_name', 'company', 'phone'])
        .orderBy(sql`display_name = ''`)
        .orderBy(sql`lower(display_name)`)
        .orderBy('created_at')
        .limit(CONTACTS_PAGE_SIZE)
        .offset((p - 1) * CONTACTS_PAGE_SIZE)
        .execute();
      return { items: await this.withEmails(trx, rows), total: Number(n) };
    });
  }

  async get(o: Owner, id: string): Promise<ContactView> {
    if (!UUID.test(id)) throw new NotFoundException();
    return this.tdb.run(ctx(o), async (trx) => {
      const row = await trx.selectFrom('contacts').select(['id', 'display_name', 'company', 'phone']).where('id', '=', id).executeTakeFirst();
      if (!row) throw new NotFoundException();
      return (await this.withEmails(trx, [row]))[0];
    });
  }

  async create(o: Owner, body: unknown): Promise<ContactView> {
    const input = parseContactInput(body);
    return this.tdb.run(ctx(o), async (trx) => {
      await this.checkLimit(trx, 1);
      return this.insert(trx, o, input);
    });
  }

  async update(o: Owner, id: string, body: unknown): Promise<ContactView> {
    if (!UUID.test(id)) throw new NotFoundException();
    const input = parseContactInput(body);
    return this.tdb.run(ctx(o), async (trx) => {
      const row = await trx
        .updateTable('contacts')
        .set({ display_name: input.displayName, company: input.company, phone: input.phone, updated_at: new Date() })
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw new NotFoundException();
      await trx.deleteFrom('contact_addresses').where('contact_id', '=', id).execute();
      await this.insertEmails(trx, o, id, input);
      return { id, ...input };
    });
  }

  async remove(o: Owner, id: string): Promise<void> {
    if (!UUID.test(id)) throw new NotFoundException();
    const r = await this.tdb.run(ctx(o), (trx) => trx.deleteFrom('contacts').where('id', '=', id).returning('id').executeTakeFirst());
    if (!r) throw new NotFoundException();
  }

  /** Recipient suggestions for the composer (FOX-073): name or address contains the text. */
  async suggest(o: Owner, q: unknown): Promise<{ name: string; email: string }[]> {
    const term = searchTerm(q);
    if (!term) return [];
    const pat = likePattern(term);
    const prefix = `${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await this.tdb.run(ctx(o), (trx) =>
      trx
        .selectFrom('contact_addresses as a')
        .innerJoin('contacts as c', 'c.id', 'a.contact_id')
        .select(['c.display_name as name', 'a.email'])
        .where((eb) => eb.or([eb('a.email', 'ilike', pat), eb('c.display_name', 'ilike', pat)]))
        // Matches at the start of the address or name first.
        .orderBy(sql`(a.email ILIKE ${prefix} OR c.display_name ILIKE ${prefix})`, 'desc')
        .orderBy(sql`lower(c.display_name)`)
        .orderBy('a.position')
        .limit(SUGGESTIONS)
        .execute(),
    );
    return rows.map((r) => ({ name: r.name, email: r.email }));
  }

  /** vCard import (FOX-075): valid cards are added, invalid ones listed; duplicates skipped by address unless asked. */
  async importVCard(o: Owner, body: unknown): Promise<{ imported: number; skipped: number; errors: string[] }> {
    const b = (body ?? {}) as { vcard?: unknown; duplicates?: unknown };
    if (b.duplicates !== undefined && b.duplicates !== 'skip' && b.duplicates !== 'add') throw new BadRequestException('duplicates must be "skip" or "add"');
    const { contacts, errors } = parseVCards(b.vcard as string);
    return this.tdb.run(ctx(o), async (trx) => {
      const existing = new Set(
        (await trx.selectFrom('contact_addresses').select('email').execute()).map((r) => r.email.toLowerCase()),
      );
      let imported = 0, skipped = 0;
      const fresh: ContactInput[] = [];
      for (const c of contacts) {
        if (b.duplicates !== 'add' && c.emails.some((e) => existing.has(e.email.toLowerCase()))) {
          skipped++;
          continue;
        }
        c.emails.forEach((e) => existing.add(e.email.toLowerCase()));
        fresh.push(c);
      }
      await this.checkLimit(trx, fresh.length);
      for (const c of fresh) {
        await this.insert(trx, o, c);
        imported++;
      }
      return { imported, skipped, errors };
    });
  }

  async exportVCard(o: Owner, ids?: unknown): Promise<string> {
    const wanted = typeof ids === 'string' && ids ? ids.split(',').filter((id) => UUID.test(id)).slice(0, MAX_CONTACTS) : null;
    if (wanted && !wanted.length) return '';
    const contacts = await this.tdb.run(ctx(o), async (trx) => {
      let q = trx.selectFrom('contacts').select(['id', 'display_name', 'company', 'phone']).orderBy(sql`lower(display_name)`);
      if (wanted) q = q.where('id', 'in', wanted);
      return this.withEmails(trx, await q.limit(MAX_CONTACTS).execute());
    });
    return contacts.length ? toVCard(contacts) : '';
  }

  private async checkLimit(trx: Transaction<Database>, adding: number) {
    const { n } = await trx.selectFrom('contacts').select((eb) => eb.fn.countAll<string>().as('n')).executeTakeFirstOrThrow();
    if (Number(n) + adding > MAX_CONTACTS) throw new BadRequestException(`an address book holds at most ${MAX_CONTACTS} contacts`);
  }

  private async insert(trx: Transaction<Database>, o: Owner, c: ContactInput): Promise<ContactView> {
    const row = await trx
      .insertInto('contacts')
      .values({ tenant_id: o.tenantId, mailbox: o.email.toLowerCase(), display_name: c.displayName, company: c.company, phone: c.phone })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.insertEmails(trx, o, row.id, c);
    return { id: row.id, ...c };
  }

  private async insertEmails(trx: Transaction<Database>, o: Owner, contactId: string, c: ContactInput) {
    if (!c.emails.length) return;
    await trx
      .insertInto('contact_addresses')
      .values(c.emails.map((e, position) => ({ tenant_id: o.tenantId, mailbox: o.email.toLowerCase(), contact_id: contactId, email: e.email, label: e.label, position })))
      .execute();
  }

  private async withEmails(trx: Transaction<Database>, rows: { id: string; display_name: string; company: string; phone: string }[]): Promise<ContactView[]> {
    if (!rows.length) return [];
    const addrs = await trx
      .selectFrom('contact_addresses')
      .select(['contact_id', 'email', 'label'])
      .where('contact_id', 'in', rows.map((r) => r.id))
      .orderBy('position')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      company: r.company,
      phone: r.phone,
      emails: addrs.filter((a) => a.contact_id === r.id).map((a) => ({ email: a.email, label: a.label })),
    }));
  }
}

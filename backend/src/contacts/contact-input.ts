import { BadRequestException } from '@nestjs/common';
import { CONTROL_CHARS, EMAIL_RE, MAX_EMAIL_LENGTH } from '../common/email';

export const MAX_EMAILS_PER_CONTACT = 10;

export interface ContactEmail { email: string; label: string }
export interface ContactInput { displayName: string; company: string; phone: string; emails: ContactEmail[] }

const bad = (what: string): never => {
  throw new BadRequestException(`Contact not saved: ${what}.`);
};

function text(v: unknown, field: string, max: number): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') bad(field);
  if (CONTROL_CHARS.test(v as string)) bad(field);
  const s = (v as string).trim();
  if (s.length > max) bad(field);
  return s;
}

/**
 * Validates a contact from the API or an import (FOX-072). Only known fields are read:
 * tenant and mailbox always come from the session, never from the body.
 */
export function parseContactInput(body: unknown): ContactInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad('expected a contact');
  const b = body as Record<string, unknown>;
  const displayName = text(b.displayName, 'the name is too long or has control characters', 200);
  const company = text(b.company, 'the company is too long or has control characters', 200);
  const phone = text(b.phone, 'the phone number is too long or has control characters', 50);

  const raw = b.emails ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_EMAILS_PER_CONTACT) bad(`at most ${MAX_EMAILS_PER_CONTACT} email addresses are allowed`);
  const seen = new Set<string>();
  const emails: ContactEmail[] = [];
  for (const item of raw as unknown[]) {
    const o = typeof item === 'string' ? { email: item } : item;
    if (!o || typeof o !== 'object') bad('an email address is not valid');
    const email = text((o as Record<string, unknown>).email, 'an email address is not valid', MAX_EMAIL_LENGTH);
    const label = text((o as Record<string, unknown>).label, 'an address label is not valid', 50);
    if (!EMAIL_RE.test(email)) bad(`“${email.slice(0, 80)}” is not a valid email address`);
    if (seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    emails.push({ email, label });
  }
  if (!displayName && !emails.length) bad('a name or an email address is required');
  return { displayName, company, phone, emails };
}

/** LIKE pattern for a search term: wildcards typed by the user are matched literally. */
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

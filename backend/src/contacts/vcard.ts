import { BadRequestException } from '@nestjs/common';
import { parseContactInput, type ContactInput } from './contact-input';

/** vCard import and export (FOX-075). Reads 2.1, 3.0 and 4.0; writes 3.0, which every client imports. */
export const MAX_VCARD_BYTES = 2_000_000;
export const MAX_VCARD_CONTACTS = 5000;

const LABELS = new Set(['work', 'home', 'other']);

interface Prop { name: string; params: Record<string, string[]>; value: string }

/** Splits "NAME;PARAM=a,b;FLAG:value" at the first colon outside quotes. */
function parseLine(line: string): Prop | null {
  let inQuote = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuote = !inQuote;
    else if (line[i] === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 1) return null;
  const [rawName, ...rawParams] = line.slice(0, colon).split(';');
  const name = rawName.replace(/^[\w-]+\./, '').toUpperCase(); // drop "item1." groups
  const params: Record<string, string[]> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    // vCard 2.1 writes bare types: EMAIL;INTERNET;WORK:...
    const key = (eq === -1 ? 'TYPE' : p.slice(0, eq)).toUpperCase();
    const vals = (eq === -1 ? p : p.slice(eq + 1)).replace(/"/g, '').split(',').map((v) => v.trim()).filter(Boolean);
    params[key] = [...(params[key] ?? []), ...vals];
  }
  return { name, params, value: line.slice(colon + 1) };
}

function decodeQuotedPrintable(s: string, charset: string): string {
  const bytes: number[] = [];
  const raw = s;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...Buffer.from(raw[i], 'utf8'));
  }
  const enc = /^(utf-?8)?$/i.test(charset) ? 'utf8' : 'latin1';
  return Buffer.from(bytes).toString(enc);
}

const unescape = (s: string) => s.replace(/\\([\\,;nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
/** Structured values (N, ORG) split on unescaped semicolons. */
const components = (s: string) => s.split(/(?<!\\);/).map(unescape);

function valueOf(p: Prop): string {
  if ((p.params.ENCODING ?? []).some((e) => e.toUpperCase() === 'QUOTED-PRINTABLE')) {
    return decodeQuotedPrintable(p.value, p.params.CHARSET?.[0] ?? 'utf-8');
  }
  return p.value;
}

function cardToInput(props: Prop[]): ContactInput {
  let fn = '', n = '', org = '', tel = '';
  const emails: { email: string; label: string }[] = [];
  for (const p of props) {
    const v = valueOf(p);
    if (p.name === 'FN' && !fn) fn = unescape(v).trim();
    else if (p.name === 'N' && !n) {
      const [family = '', given = ''] = components(v);
      n = [given, family].map((x) => x.trim()).filter(Boolean).join(' ');
    } else if (p.name === 'ORG' && !org) org = components(v)[0]?.trim() ?? '';
    else if (p.name === 'TEL' && !tel) tel = unescape(v).replace(/^tel:/i, '').trim();
    else if (p.name === 'EMAIL') {
      const label = (p.params.TYPE ?? []).map((t) => t.toLowerCase()).find((t) => LABELS.has(t)) ?? '';
      emails.push({ email: unescape(v).replace(/^mailto:/i, '').trim(), label });
    }
  }
  return parseContactInput({ displayName: fn || n, company: org, phone: tel, emails });
}

export function parseVCards(text: string): { contacts: ContactInput[]; errors: string[] } {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_VCARD_BYTES) {
    throw new BadRequestException(`vCard file must be text of at most ${MAX_VCARD_BYTES / 1_000_000} MB`);
  }
  // Unfold continuation lines (RFC 6350 3.2). vCard 2.1 quoted-printable values continue
  // after a trailing "=" instead; join those only for quoted-printable properties.
  const physical = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const lines: string[] = [];
  for (let i = 0; i < physical.length; i++) {
    let l = physical[i];
    if (/QUOTED-PRINTABLE/i.test(l.split(':')[0])) while (l.endsWith('=') && i + 1 < physical.length) l = l.slice(0, -1) + physical[++i];
    lines.push(l);
  }
  const contacts: ContactInput[] = [];
  const errors: string[] = [];
  let card: Prop[] | null = null;
  let index = 0;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === 'BEGIN:VCARD') {
      card = [];
      index++;
    } else if (upper === 'END:VCARD' && card) {
      if (index > MAX_VCARD_CONTACTS) throw new BadRequestException(`at most ${MAX_VCARD_CONTACTS} contacts per import`);
      try {
        contacts.push(cardToInput(card));
      } catch (e) {
        errors.push(`Contact ${index}: ${(e as Error).message.replace(/^Contact not saved: /, '')}`);
      }
      card = null;
    } else if (card) {
      const p = parseLine(line);
      if (p) card.push(p);
    }
  }
  return { contacts, errors };
}

const escape = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n');

/** Folds at 75 octets without splitting a UTF-8 character (RFC 6350 3.2). */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > limit) {
      out.push(cur);
      cur = '';
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function toVCard(contacts: ContactInput[]): string {
  const lines: string[] = [];
  for (const c of contacts) {
    const parts = c.displayName.split(' ');
    const family = parts.length > 1 ? parts.pop()! : '';
    lines.push('BEGIN:VCARD', 'VERSION:3.0', `FN:${escape(c.displayName)}`, `N:${escape(family)};${escape(parts.join(' '))};;;`);
    if (c.company) lines.push(`ORG:${escape(c.company)}`);
    if (c.phone) lines.push(`TEL;TYPE=VOICE:${escape(c.phone)}`);
    for (const e of c.emails) lines.push(`EMAIL;TYPE=INTERNET${e.label ? `,${e.label.toUpperCase()}` : ''}:${escape(e.email)}`);
    lines.push('END:VCARD');
  }
  return lines.map(fold).join('\r\n') + '\r\n';
}

import { randomBytes } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import MailComposer from 'nodemailer/lib/mail-composer';
import { EMAIL_RE } from '../common/email';
import { sanitizeEmailHtml } from '../security/sanitize';
import { validateInlineImages } from './inline-images';

export const MAX_RECIPIENTS = 100;

export interface OutgoingInput {
  to?: unknown; cc?: unknown; bcc?: unknown; subject?: unknown; text?: unknown; html?: unknown; inlineImages?: unknown;
}

export interface Outgoing {
  to: string[]; cc: string[]; bcc: string[]; subject: string; text: string; html?: string;
  attachments: ReturnType<typeof validateInlineImages>;
}

/**
 * Validates a message before sending or saving it as a draft. Drafts may be unfinished
 * (no recipients, half-typed addresses, no subject), but the same header-injection,
 * HTML and inline-image rules apply to both.
 */
export function parseOutgoing(m: OutgoingInput, mode: 'send' | 'draft'): Outgoing {
  if (!m || typeof m !== 'object') throw new BadRequestException('invalid message');
  const list = (v: unknown): string[] => {
    if (v !== undefined && !Array.isArray(v)) throw new BadRequestException('recipients must be a list');
    const out = ((v as unknown[] | undefined) ?? []).map((s) => String(s).trim()).filter(Boolean);
    if (mode === 'draft') return out.filter((a) => EMAIL_RE.test(a)); // unfinished addresses are not kept
    for (const a of out) if (!EMAIL_RE.test(a)) throw new BadRequestException(`invalid address: ${a.slice(0, 100)}`);
    return out;
  };
  const to = list(m.to), cc = list(m.cc), bcc = list(m.bcc);
  if (mode === 'send' && !to.length) throw new BadRequestException('at least one recipient required');
  if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) throw new BadRequestException('too many recipients');
  const subject = m.subject ?? '';
  if (typeof subject !== 'string' || subject.length > 998 || /[\r\n]/.test(subject)) {
    throw new BadRequestException('invalid subject'); // header-injection guard
  }
  const html = typeof m.html === 'string' && m.html ? sanitizeEmailHtml(m.html) : undefined;
  // Inline images from the editor (cid:), validated by sniffed type and size (rule 11).
  const attachments = validateInlineImages(m.inlineImages, html ?? '');
  return { to, cc, bcc, subject, text: typeof m.text === 'string' ? m.text : '', html, attachments };
}

function compose(address: string, name: string | undefined, d: Outgoing, messageId: string, date: Date, keepBcc: boolean): Promise<Buffer> {
  const node = new MailComposer({
    from: name ? { name, address } : address,
    to: d.to, cc: d.cc, bcc: d.bcc,
    subject: d.subject,
    text: d.text,
    html: d.html,
    attachments: d.attachments,
    messageId,
    date,
    // Content comes only from validated input; never from local files or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  }).compile();
  node.keepBcc = keepBcc;
  return node.build();
}

const newMessageId = (address: string, kind: string) => `<${kind}.${randomBytes(12).toString('hex')}@${address.split('@')[1] ?? 'localhost'}>`;

/** MIME source of a draft, for IMAP APPEND to the Drafts folder. A draft keeps Bcc so it can be sent later. */
export async function buildDraftMime(address: string, name: string | undefined, d: Outgoing): Promise<{ raw: Buffer; messageId: string }> {
  const messageId = newMessageId(address, 'draft');
  return { raw: await compose(address, name, d, messageId, new Date(), true), messageId };
}

/**
 * One message, built twice with the same Message-ID and Date (OPEN-4): `smtpRaw` without
 * the Bcc header for sending, `copyRaw` with it for the sender's Sent folder.
 */
export async function buildSendMime(address: string, name: string | undefined, d: Outgoing) {
  const messageId = newMessageId(address, 'fx');
  const date = new Date();
  const [smtpRaw, copyRaw] = await Promise.all([compose(address, name, d, messageId, date, false), compose(address, name, d, messageId, date, true)]);
  return { smtpRaw, copyRaw, messageId, envelope: { from: address, to: [...d.to, ...d.cc, ...d.bcc] } };
}

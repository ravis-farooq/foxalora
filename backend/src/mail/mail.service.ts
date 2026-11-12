import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ImapFlow, MessageAddressObject, MessageStructureObject } from 'imapflow';
import type { Readable } from 'node:stream';
import { safeFilename } from '../security/filename';
import { sanitizeEmailHtml } from '../security/sanitize';
import { MailboxCreds, openImap, withSmtp } from './connections';
import { decodePart } from './decode-part';
import { MailError, normalizeMailError } from './mail-errors';
import { assertFolder, decodeMessageId, encodeMessageId, type MessageRef } from './message-id';
import { buildDraftMime, parseOutgoing, type Outgoing, type OutgoingInput } from './outgoing';
import { MAX_SEARCH_RESULTS, searchCriteria } from './search';

const MAX_PAGE_SIZE = 100;
// Fetch policy (CLAUDE.md rule 10, D1): only text parts are read when a message is
// opened, each capped; attachments are streamed one part at a time, on request.
const MAX_TEXT_BYTES = Number(process.env.MAIL_MAX_TEXT_BYTES ?? 2 * 1024 * 1024);
const MAX_ATTACHMENT_BYTES = Number(process.env.MAIL_MAX_ATTACHMENT_BYTES ?? 50 * 1024 * 1024);
const PART_ID = /^\d{1,4}(\.\d{1,4}){0,20}$/;

interface PartInfo {
  part: string;
  contentType: string;
  filename: string;
  size: number;
  inline: boolean;
  contentId: string | null;
  encoding: string | undefined;
  charset: string | undefined;
}

// Names for parts that arrive without one (bounces and receipts are made of these).
const NAMED_TYPES: Record<string, string> = {
  'message/delivery-status': 'delivery-report.txt',
  'message/global-delivery-status': 'delivery-report.txt',
  'message/disposition-notification': 'read-receipt.txt',
  'message/rfc822': 'attached-message.eml',
  'message/global': 'attached-message.eml',
  'text/rfc822-headers': 'original-headers.txt',
  'text/calendar': 'invitation.ics',
};
const EXTENSIONS: Record<string, string> = {
  'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv', 'application/pdf': 'pdf', 'application/zip': 'zip',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
};
const fallbackName = (type: string, part: string) =>
  NAMED_TYPES[type] ?? `attachment-${part}${EXTENSIONS[type] ? `.${EXTENSIONS[type]}` : ''}`;

/** Splits a body structure into the displayable text/html parts and everything else. */
export function classifyParts(root: MessageStructureObject | undefined) {
  let text: PartInfo | undefined;
  let html: PartInfo | undefined;
  const attachments: PartInfo[] = [];
  const visit = (node: MessageStructureObject) => {
    const type = (node.type ?? '').toLowerCase();
    // An attached email is one attachment; its own parts are not shown inline.
    if (node.childNodes?.length && type !== 'message/rfc822') {
      for (const c of node.childNodes) visit(c);
      return;
    }
    const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
    const info: PartInfo = {
      part: node.part ?? '1',
      contentType: type,
      filename: safeFilename(filename, fallbackName(type, node.part ?? '1')),
      size: node.encoding === 'base64' && node.size ? Math.floor((node.size * 3) / 4) : node.size ?? 0,
      inline: node.disposition === 'inline',
      contentId: node.id ? node.id.replace(/^<|>$/g, '') : null,
      encoding: node.encoding,
      charset: node.parameters?.charset,
    };
    const bodyCandidate = node.disposition !== 'attachment' && !filename;
    if (bodyCandidate && type === 'text/plain' && !text) text = info;
    else if (bodyCandidate && type === 'text/html' && !html) html = info;
    else attachments.push(info);
  };
  if (root) visit(root);
  return { text, html, attachments };
}

const addr = (list?: MessageAddressObject[]) => (list ?? []).map((a) => ({ name: a.name ?? '', address: a.address ?? '' }));

async function readCapped(stream: Readable, max: number, as: BufferEncoding = 'utf8'): Promise<{ text: string; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (size + b.length > max) {
      chunks.push(b.subarray(0, max - size));
      truncated = true;
      stream.destroy();
      break;
    }
    chunks.push(b);
    size += b.length;
  }
  return { text: Buffer.concat(chunks).toString(as), truncated };
}

/**
 * Mailbox operations. Every IMAP/SMTP error is converted to a stable code (FOX-028)
 * and message ids carry UIDVALIDITY, checked before every action (FOX-027).
 * Prototype strategy: one short-lived IMAP connection per request (pooling: FOX-029).
 */
@Injectable()
export class MailService {
  private async withImap<T>(c: MailboxCreds, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    let client: ImapFlow | undefined;
    try {
      client = await openImap(c);
      return await fn(client);
    } catch (e) {
      throw normalizeMailError(e);
    } finally {
      if (client) await client.logout().catch(() => client?.close());
    }
  }

  /** Opens the message's folder and refuses to act if UIDVALIDITY changed since the id was issued. */
  private async withMessage<T>(c: MailboxCreds, id: unknown, fn: (client: ImapFlow, ref: MessageRef) => Promise<T>): Promise<T> {
    const ref = decodeMessageId(id);
    return this.withImap(c, async (client) => {
      const lock = await client.getMailboxLock(ref.folder);
      try {
        const current = client.mailbox ? BigInt(client.mailbox.uidValidity) : 0n;
        if (current !== ref.uidValidity) {
          throw new MailError('folder_reset', 409, 'This folder was reset on the mail server. Reload the message list.');
        }
        return await fn(client, ref);
      } finally {
        lock.release();
      }
    });
  }

  /** Verify credentials for login: IMAP auth + SMTP auth (AUTH-002, AUTH-003). Raw errors, for the auth log. */
  async verifyLogin(c: MailboxCreds): Promise<void> {
    const client = await openImap(c);
    await client.logout().catch(() => client.close());
    await withSmtp(c, (t) => t.verify());
  }

  async listFolders(c: MailboxCreds) {
    return this.withImap(c, async (client) => {
      const boxes = await client.list({ statusQuery: { messages: true, unseen: true } });
      return boxes.map((b) => ({
        path: b.path,
        name: b.name,
        // Folder role from IMAP SPECIAL-USE attribute, not from the folder name (PRD Module 2)
        specialUse: b.specialUse ?? (b.path.toUpperCase() === 'INBOX' ? '\\Inbox' : null),
        total: b.status?.messages ?? 0,
        unseen: b.status?.unseen ?? 0,
      }));
    });
  }

  async listMessages(c: MailboxCreds, folderRaw: string, page: number, pageSize: number, query?: unknown) {
    const folder = assertFolder(folderRaw);
    const criteria = searchCriteria(query);
    page = Math.max(1, Math.floor(page) || 1);
    pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize) || 25));

    return this.withImap(c, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const box = client.mailbox;
        if (!box) throw new NotFoundException();
        const uidValidity = String(box.uidValidity);
        let total = box.exists;
        let range: string;
        let byUid = false;
        if (criteria) {
          // Search runs on the server; newest first, capped so a broad search stays cheap.
          const found = (await client.search(criteria, { uid: true })) || [];
          const uids = found.sort((a, b) => b - a).slice(0, MAX_SEARCH_RESULTS);
          total = uids.length;
          const pageUids = uids.slice((page - 1) * pageSize, page * pageSize);
          if (!pageUids.length) return { uidValidity, total, items: [] };
          range = pageUids.join(',');
          byUid = true;
        } else {
          const end = total - (page - 1) * pageSize;
          if (end < 1) return { uidValidity, total, items: [] };
          range = `${Math.max(1, end - pageSize + 1)}:${end}`;
        }

        const items = [];
        // Headers/envelope only; bodies are fetched when a message is opened. A sequence
        // range only pages the plain list; every item is identified by UID.
        for await (const m of client.fetch(range, { uid: true, envelope: true, flags: true, bodyStructure: true }, { uid: byUid })) {
          const from = m.envelope?.from?.[0];
          items.push({
            id: encodeMessageId(folder, box.uidValidity, m.uid),
            subject: m.envelope?.subject ?? '(no subject)',
            from: { name: from?.name ?? '', address: from?.address ?? '' },
            date: m.envelope?.date ?? null,
            seen: m.flags?.has('\\Seen') ?? false,
            flagged: m.flags?.has('\\Flagged') ?? false,
            hasAttachment: classifyParts(m.bodyStructure).attachments.some((a) => !a.inline),
            uid: m.uid,
          });
        }
        items.sort((a, b) => b.uid - a.uid);
        return { uidValidity, total, items: items.map(({ uid: _uid, ...rest }) => rest) };
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(c: MailboxCreds, id: unknown) {
    return this.withMessage(c, id, async (client, ref) => {
      const uid = String(ref.uid);
      const msg = await client.fetchOne(uid, { uid: true, envelope: true, bodyStructure: true, flags: true, size: true }, { uid: true });
      if (!msg) throw new NotFoundException();
      const { text, html, attachments } = classifyParts(msg.bodyStructure);

      const read = async (p?: PartInfo) => {
        if (!p) return null;
        const d = await client.download(uid, p.part, { uid: true, maxBytes: MAX_TEXT_BYTES });
        if (!d.content) return null;
        if ((d.meta.contentType ?? '').toLowerCase() === p.contentType) return readCapped(d.content, MAX_TEXT_BYTES);
        // The server answered BODY[part.MIME] with headers of another part, so imapflow
        // could not decode it: decode from BODYSTRUCTURE instead (seen on GreenMail).
        const raw = await readCapped(d.content, MAX_TEXT_BYTES, 'latin1');
        return { text: decodePart(Buffer.from(raw.text, 'latin1'), p.encoding, p.charset), truncated: raw.truncated };
      };
      const textBody = await read(text);
      const htmlBody = await read(html);
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });

      const env = msg.envelope;
      return {
        id: encodeMessageId(ref.folder, ref.uidValidity, ref.uid),
        subject: env?.subject ?? '(no subject)',
        from: addr(env?.from),
        to: addr(env?.to),
        cc: addr(env?.cc),
        bcc: addr(env?.bcc),
        replyTo: addr(env?.replyTo),
        date: env?.date ?? null,
        messageId: env?.messageId ?? null,
        inReplyTo: env?.inReplyTo ?? null,
        flagged: msg.flags?.has('\\Flagged') ?? false,
        text: textBody?.text ?? '',
        // Untrusted: sanitized here, then rendered in a sandboxed iframe by the UI.
        html: htmlBody ? sanitizeEmailHtml(htmlBody.text) : null,
        truncated: !!(textBody?.truncated || htmlBody?.truncated),
        attachments: attachments.map((a) => ({ part: a.part, filename: a.filename, size: a.size, contentType: a.contentType, inline: a.inline })),
      };
    });
  }

  /** Streams one attachment part to `sink` without buffering the message (D1). */
  async streamAttachment(c: MailboxCreds, id: unknown, partRaw: unknown, onStart: (filename: string) => NodeJS.WritableStream) {
    if (typeof partRaw !== 'string' || !PART_ID.test(partRaw)) throw new BadRequestException('invalid part');
    return this.withMessage(c, id, async (client, ref) => {
      const uid = String(ref.uid);
      const msg = await client.fetchOne(uid, { uid: true, bodyStructure: true }, { uid: true });
      const part = msg ? classifyParts(msg.bodyStructure).attachments.find((a) => a.part === partRaw) : undefined;
      if (!part) throw new NotFoundException();
      const d = await client.download(uid, part.part, { uid: true, maxBytes: MAX_ATTACHMENT_BYTES });
      if (!d.content) throw new NotFoundException();
      const sink = onStart(part.filename);
      await new Promise<void>((resolve, reject) => {
        d.content.on('error', reject);
        sink.on('error', reject);
        sink.on('finish', resolve);
        d.content.pipe(sink);
      });
    });
  }

  async setFlags(c: MailboxCreds, id: unknown, f: { seen?: boolean; flagged?: boolean }) {
    await this.withMessage(c, id, async (client, ref) => {
      const uid = String(ref.uid);
      const set = async (flag: string, on?: boolean) => {
        if (on === true) await client.messageFlagsAdd(uid, [flag], { uid: true });
        if (on === false) await client.messageFlagsRemove(uid, [flag], { uid: true });
      };
      await set('\\Seen', f.seen);
      await set('\\Flagged', f.flagged);
    });
  }

  /** Moves to Trash (returns the id there, for Undo), or deletes for good when already in Trash. */
  async deleteMessage(c: MailboxCreds, id: unknown): Promise<{ trashId: string | null }> {
    return this.withMessage(c, id, async (client, ref) => {
      const boxes = await client.list();
      const trash = boxes.find((b) => b.specialUse === '\\Trash');
      if (trash && trash.path !== ref.folder) {
        const res = await client.messageMove(String(ref.uid), trash.path, { uid: true });
        const newUid = res && res.uidMap?.get(ref.uid);
        return { trashId: res && newUid && res.uidValidity ? encodeMessageId(trash.path, res.uidValidity, newUid) : null };
      }
      await client.messageDelete(String(ref.uid), { uid: true }); // already in Trash: permanent
      return { trashId: null };
    });
  }

  async send(c: MailboxCreds, m: OutgoingInput, fromName?: string): Promise<Outgoing> {
    const out = parseOutgoing(m, 'send');
    try {
      await withSmtp(c, (t) =>
        t.sendMail({
          // From is ALWAYS the authenticated mailbox: users cannot spoof other senders (prototype policy).
          // The name is validated in preferences (no control characters, no address look-alikes).
          from: fromName ? { name: fromName, address: c.email } : c.email,
          to: out.to, cc: out.cc, bcc: out.bcc,
          subject: out.subject,
          text: out.text,
          html: out.html,
          attachments: out.attachments,
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
      );
    } catch (e) {
      throw normalizeMailError(e);
    }
    return out;
  }

  private async specialFolder(client: ImapFlow, use: string): Promise<string> {
    const box = (await client.list()).find((b) => b.specialUse === use);
    if (!box) throw new MailError('folder_not_found', 404, `There is no ${use.slice(1)} folder on the mail server.`);
    return box.path;
  }

  /**
   * Saves a draft to the Drafts folder with IMAP APPEND (FOX-055). When `replaceId` names an
   * earlier version, it is removed after the new one is stored, so nothing is lost if a
   * step fails. Only messages in the Drafts folder can be replaced.
   */
  async saveDraft(c: MailboxCreds, m: OutgoingInput & { replaceId?: unknown }, fromName?: string): Promise<{ id: string }> {
    const draft = parseOutgoing(m, 'draft');
    const replace = m.replaceId === undefined || m.replaceId === null ? null : decodeMessageId(m.replaceId);
    const { raw, messageId } = await buildDraftMime(c.email, fromName, draft);
    return this.withImap(c, async (client) => {
      const drafts = await this.specialFolder(client, '\\Drafts');
      if (replace && replace.folder !== drafts) throw new BadRequestException('only drafts can be replaced');
      const res = await client.append(drafts, raw, ['\\Draft', '\\Seen']);
      const lock = await client.getMailboxLock(drafts);
      try {
        const uidValidity = BigInt(client.mailbox ? client.mailbox.uidValidity : 0);
        let uid = res && res.uid && res.uidValidity === uidValidity ? res.uid : undefined;
        if (!uid) {
          // No UIDPLUS: find the new draft by its Message-ID.
          const found = (await client.search({ header: { 'message-id': messageId } }, { uid: true })) || [];
          uid = found.sort((a, b) => b - a)[0];
        }
        if (!uid) throw new MailError('mail_protocol_error', 502, 'The mail server did not confirm the saved draft.');
        if (replace && replace.uidValidity === uidValidity && replace.uid !== uid) {
          await client.messageDelete(String(replace.uid), { uid: true });
        }
        return { id: encodeMessageId(drafts, uidValidity, uid) };
      } finally {
        lock.release();
      }
    });
  }

  /** Removes a draft for good (after sending it, or when the user discards it). */
  async deleteDraft(c: MailboxCreds, id: unknown): Promise<void> {
    const ref = decodeMessageId(id);
    await this.withImap(c, async (client) => {
      if (ref.folder !== (await this.specialFolder(client, '\\Drafts'))) throw new BadRequestException('not a draft');
    });
    await this.withMessage(c, id, (client, r) => client.messageDelete(String(r.uid), { uid: true }).then(() => undefined));
  }

  /** Moves a message to another existing folder (FOX-035, single message). Returns its new id when the server reports it. */
  async moveMessage(c: MailboxCreds, id: unknown, folderRaw: unknown): Promise<{ id: string | null }> {
    const target = assertFolder(folderRaw);
    const ref = decodeMessageId(id);
    if (target === ref.folder) return { id: String(id) };
    return this.withMessage(c, id, async (client) => {
      if (!(await client.list()).some((b) => b.path === target)) throw new MailError('folder_not_found', 404, 'Folder not found.');
      const res = await client.messageMove(String(ref.uid), target, { uid: true });
      const newUid = res && res.uidMap?.get(ref.uid);
      return { id: res && newUid && res.uidValidity ? encodeMessageId(target, res.uidValidity, newUid) : null };
    });
  }
}

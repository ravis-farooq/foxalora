import { BadRequestException } from '@nestjs/common';
import { CONTROL_CHARS } from '../common/email';
import { assertFolder, decodeMessageId } from './message-id';

/** Folder roles that users cannot rename or delete (FOX-038). */
const PROTECTED_ROLES = new Set(['\\Inbox', '\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\Archive', '\\All', '\\Flagged']);

export function isProtectedFolder(f: { path: string; specialUse?: string | null }): boolean {
  return f.path.toUpperCase() === 'INBOX' || (!!f.specialUse && PROTECTED_ROLES.has(f.specialUse));
}

/**
 * Validates one level of a folder name. The server's hierarchy delimiter and the IMAP
 * wildcards are refused, so a name can never reach into another part of the tree.
 */
export function validateFolderName(raw: unknown, delimiter: string): string {
  if (typeof raw !== 'string') throw new BadRequestException('Folder name is missing.');
  const name = raw.trim();
  if (!name) throw new BadRequestException('Give the folder a name.');
  if (name.length > 100) throw new BadRequestException('Folder names can be up to 100 characters.');
  // "/" is refused on every server, so names stay portable between servers with different delimiters.
  if (CONTROL_CHARS.test(name) || /[*%"\\/]/.test(name) || (delimiter && name.includes(delimiter))) {
    throw new BadRequestException(`Folder names cannot contain ${delimiter && delimiter !== '/' ? `"${delimiter}", ` : ''}/, *, %, " or \\.`);
  }
  if (name.toUpperCase() === 'INBOX') throw new BadRequestException('That name is reserved.');
  return name;
}

export const MAX_BULK = 500;
export const BULK_ACTIONS = ['seen', 'unseen', 'flag', 'unflag', 'move', 'delete', 'archive', 'junk', 'notjunk'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkRequest { folder: string; uidValidity: bigint; uids: number[]; action: BulkAction; target?: string }

/** Validates a bulk request: up to 500 message ids from one folder (same UIDVALIDITY), one action. */
export function parseBulk(body: unknown): BulkRequest {
  if (!body || typeof body !== 'object') throw new BadRequestException('invalid request');
  const b = body as { ids?: unknown; action?: unknown; target?: unknown };
  if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > MAX_BULK) throw new BadRequestException(`Select between 1 and ${MAX_BULK} messages.`);
  if (!BULK_ACTIONS.includes(b.action as BulkAction)) throw new BadRequestException('unknown action');
  const refs = b.ids.map((id) => decodeMessageId(id));
  const { folder, uidValidity } = refs[0];
  if (refs.some((r) => r.folder !== folder || r.uidValidity !== uidValidity)) {
    throw new BadRequestException('All selected messages must be in the same folder.');
  }
  const action = b.action as BulkAction;
  if (action === 'move' && b.target === undefined) throw new BadRequestException('Choose a folder to move to.');
  return {
    folder,
    uidValidity,
    uids: [...new Set(refs.map((r) => r.uid))],
    action,
    target: action === 'move' ? assertFolder(b.target) : undefined,
  };
}

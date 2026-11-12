import { BadRequestException } from '@nestjs/common';
import type { SearchObject } from 'imapflow';

/** Quick search (E09): text typed in the search box, matched by the mail server. */
export const MAX_SEARCH_LENGTH = 100;
/** A broad search on a huge mailbox stops here instead of paging through everything. */
export const MAX_SEARCH_RESULTS = 1000;

/**
 * Maps the search box text to IMAP SEARCH criteria (subject, sender or recipient).
 * Returns null when there is nothing to search for. The text is passed as data; the
 * IMAP library quotes it, and control characters (which could end the command) are refused.
 */
export function searchCriteria(raw: unknown): SearchObject | null {
  if (raw === undefined) return null;
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
  if (typeof raw !== 'string' || raw.length > MAX_SEARCH_LENGTH || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new BadRequestException('invalid search');
  }
  const q = raw.trim();
  if (!q) return null;
  return { or: [{ subject: q }, { from: q }, { to: q }] };
}

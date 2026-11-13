import type { ImapFlow } from 'imapflow';

export type SentCopy = 'saved' | 'server' | 'no_folder' | 'failed';

/**
 * Keeps a copy of a sent message in the folder marked \Sent (OPEN-4), already read.
 * A missing Sent folder is reported, not created. Append errors are passed on so the
 * caller can tell the user the copy failed; the message itself was already sent.
 */
export async function saveSentCopy(client: Pick<ImapFlow, 'list' | 'append'>, raw: Buffer): Promise<'saved' | 'no_folder'> {
  const sent = (await client.list()).find((b) => b.specialUse === '\\Sent');
  if (!sent) return 'no_folder';
  await client.append(sent.path, raw, ['\\Seen']);
  return 'saved';
}

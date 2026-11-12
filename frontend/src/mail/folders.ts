import type { Folder } from '../api';
import type { IconName } from '../ui/icons';

// Folder roles come from IMAP SPECIAL-USE (the server marks INBOX itself), not from names.
const ROLES: Record<string, { label: string; order: number; icon: IconName }> = {
  '\\Inbox': { label: 'Inbox', order: 0, icon: 'inbox' },
  '\\Drafts': { label: 'Drafts', order: 1, icon: 'drafts' },
  '\\Sent': { label: 'Sent', order: 2, icon: 'send' },
  '\\Archive': { label: 'Archive', order: 3, icon: 'archive' },
  '\\Junk': { label: 'Junk', order: 4, icon: 'junk' },
  '\\Trash': { label: 'Trash', order: 5, icon: 'trash' },
  '\\Flagged': { label: 'Starred', order: 6, icon: 'star' },
  '\\All': { label: 'All mail', order: 7, icon: 'mail' },
};

type FolderLike = Pick<Folder, 'name' | 'specialUse'>;

const role = (f: FolderLike) => (f.specialUse ? ROLES[f.specialUse] : undefined);

/** "INBOX" -> "Inbox"; folders with a role get its name, others keep their own. */
export const folderLabel = (f: FolderLike) => role(f)?.label ?? f.name;
export const folderIcon = (f: FolderLike): IconName => role(f)?.icon ?? 'folder';

/** Role folders first in a fixed order, then the user's own folders alphabetically. */
export function sortFolders<T extends FolderLike>(folders: T[]): T[] {
  return [...folders].sort((a, b) => (role(a)?.order ?? 100) - (role(b)?.order ?? 100) || folderLabel(a).localeCompare(folderLabel(b)));
}

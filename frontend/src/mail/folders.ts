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

/**
 * Where "Restore" puts a message from Trash: the folder it was deleted from (known for
 * messages deleted in this session) if that folder still exists, otherwise the Inbox.
 * IMAP does not record where a message came from, so older Trash items go to the Inbox.
 */
export function restoreTarget<T extends Pick<Folder, 'path' | 'specialUse'>>(folders: T[], origin?: string): T | undefined {
  const fromOrigin = origin ? folders.find((f) => f.path === origin && f.specialUse !== '\\Trash') : undefined;
  return fromOrigin ?? folders.find((f) => f.specialUse === '\\Inbox') ?? folders.find((f) => f.path.toUpperCase() === 'INBOX');
}

const PROTECTED = new Set(['\\Inbox', '\\Sent', '\\Drafts', '\\Trash', '\\Junk', '\\Archive', '\\All', '\\Flagged']);
/** Folders with a role (and the Inbox) cannot be renamed or deleted; the server enforces this too. */
export const isProtected = (f: Pick<Folder, 'path' | 'specialUse'>) => f.path.toUpperCase() === 'INBOX' || (!!f.specialUse && PROTECTED.has(f.specialUse));

export interface FolderRow<T> { folder: T; depth: number; hasChildren: boolean; expanded: boolean }

/**
 * Folder tree for the sidebar: role folders first in their fixed order, then the user's
 * own folders alphabetically; subfolders (such as Inbox > Work) under their parent.
 * Folders inside a collapsed folder are left out.
 */
export function folderRows<T extends Pick<Folder, 'path' | 'name' | 'specialUse' | 'parentPath'>>(folders: T[], collapsed: Set<string> = new Set()): FolderRow<T>[] {
  const paths = new Set(folders.map((f) => f.path));
  const children = new Map<string, T[]>();
  for (const f of folders) {
    const parent = f.parentPath && paths.has(f.parentPath) ? f.parentPath : ''; // orphans go to the top
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const rows: FolderRow<T>[] = [];
  const walk = (parent: string, depth: number) => {
    const list = children.get(parent) ?? [];
    for (const f of depth === 0 ? sortFolders(list) : [...list].sort((a, b) => folderLabel(a).localeCompare(folderLabel(b)))) {
      const kids = children.get(f.path)?.length ?? 0;
      const expanded = !collapsed.has(f.path);
      rows.push({ folder: f, depth, hasChildren: kids > 0, expanded });
      if (kids && expanded) walk(f.path, depth + 1);
    }
  };
  walk('', 0);
  return rows;
}

/** Folders a message can be moved to from `current`. */
export const moveTargets = <T extends Pick<Folder, 'path' | 'selectable'>>(folders: T[], current: string) =>
  folders.filter((f) => f.selectable && f.path !== current);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

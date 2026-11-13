import { describe, expect, it } from 'vitest';
import { folderIcon, folderLabel, folderRows, formatBytes, isProtected, moveTargets, restoreTarget, sortFolders } from '../../src/mail/folders';
import { avatarOf, forwardSubject, replyAllRecipients, replySubject, setDisplayTimeZone, shortDate } from '../../src/mail/format';

const f = (name: string, specialUse: string | null) => ({ name, specialUse });

describe('folders', () => {
  it('names folders by role, so INBOX reads "Inbox" and localized server names are not needed', () => {
    expect(folderLabel(f('INBOX', '\\Inbox'))).toBe('Inbox');
    expect(folderLabel(f('Gesendet', '\\Sent'))).toBe('Sent');
    expect(folderLabel(f('Projects', null))).toBe('Projects');
    expect(folderIcon(f('Spam', '\\Junk'))).toBe('junk');
    expect(folderIcon(f('Projects', null))).toBe('folder');
  });

  it('puts role folders first in a fixed order, then the rest alphabetically', () => {
    const sorted = sortFolders([f('Zeta', null), f('Trash', '\\Trash'), f('Alpha', null), f('Sent', '\\Sent'), f('INBOX', '\\Inbox'), f('Junk', '\\Junk'), f('Drafts', '\\Drafts')]);
    expect(sorted.map(folderLabel)).toEqual(['Inbox', 'Drafts', 'Sent', 'Junk', 'Trash', 'Alpha', 'Zeta']);
  });
});

describe('folder tree', () => {
  const box = (path: string, specialUse: string | null = null, parentPath = '', name = path.split(/[./]/).pop()!) => ({ path, name, specialUse, parentPath, selectable: true });
  const folders = [
    box('INBOX', '\\Inbox'), box('INBOX.Work', null, 'INBOX'), box('INBOX.Personal', null, 'INBOX'), box('INBOX.Work.2026', null, 'INBOX.Work'),
    box('Sent', '\\Sent'), box('Trash', '\\Trash'), box('Archive', '\\Archive'), box('Zeta'), box('Alpha'), box('Lost.Child', null, 'Lost'),
  ];
  const show = (rows: { folder: { path: string }; depth: number }[]) => rows.map((r) => `${'-'.repeat(r.depth)}${r.folder.path}`);

  it('nests subfolders under their parent, roles first, then the rest alphabetically', () => {
    expect(show(folderRows(folders))).toEqual([
      'INBOX', '-INBOX.Personal', '-INBOX.Work', '--INBOX.Work.2026', 'Sent', 'Archive', 'Trash', 'Alpha', 'Lost.Child', 'Zeta',
    ]);
  });

  it('hides the inside of collapsed folders and says which rows can expand', () => {
    const rows = folderRows(folders, new Set(['INBOX.Work']));
    expect(show(rows)).toContain('-INBOX.Work');
    expect(show(rows)).not.toContain('--INBOX.Work.2026');
    expect(rows.find((r) => r.folder.path === 'INBOX.Work')).toMatchObject({ hasChildren: true, expanded: false });
  });

  it('protects role folders, offers only other selectable folders as move targets, and formats sizes', () => {
    expect(isProtected({ path: 'INBOX', specialUse: null })).toBe(true);
    expect(isProtected({ path: 'Archive', specialUse: '\\Archive' })).toBe(true);
    expect(isProtected({ path: 'INBOX.Work', specialUse: null })).toBe(false);
    expect(moveTargets([...folders, { ...box('Container'), selectable: false }], 'INBOX').map((f) => f.path)).not.toContain('INBOX');
    expect(moveTargets([...folders, { ...box('Container'), selectable: false }], 'INBOX').map((f) => f.path)).not.toContain('Container');
    expect([formatBytes(512), formatBytes(26624), formatBytes(1073741824), formatBytes(1610612736)]).toEqual(['512 B', '26 KB', '1 GB', '1.5 GB']);
  });
});

describe('restoreTarget (Restore from Trash)', () => {
  const folders = [
    { path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Projects', specialUse: null },
    { path: 'Archive', specialUse: '\\Archive' }, { path: 'Trash', specialUse: '\\Trash' },
  ];
  it('returns the folder the message was deleted from', () => {
    expect(restoreTarget(folders, 'Projects')?.path).toBe('Projects');
  });
  it('falls back to the Inbox when the origin is unknown, gone, or Trash itself', () => {
    expect(restoreTarget(folders)?.path).toBe('INBOX');
    expect(restoreTarget(folders, 'Deleted folder')?.path).toBe('INBOX');
    expect(restoreTarget(folders, 'Trash')?.path).toBe('INBOX');
  });
});

describe('reply and forward helpers', () => {
  const a = (address: string, name = '') => ({ address, name });

  it('reply all: sender and other recipients, without me (any case) and without duplicates', () => {
    const r = replyAllRecipients({ from: [a('dave@x.test')], to: [a('Carol@X.test'), a('erin@x.test'), a('dave@x.test')], cc: [a('frank@x.test'), a('erin@x.test')] }, 'carol@x.test');
    expect(r).toEqual({ to: ['dave@x.test', 'erin@x.test'], cc: ['frank@x.test'] });
  });

  it('reply all to my own sent message goes to its recipients', () => {
    expect(replyAllRecipients({ from: [a('carol@x.test')], to: [a('dave@x.test')], cc: [] }, 'carol@x.test')).toEqual({ to: ['dave@x.test'], cc: [] });
  });

  it('reply all to a note to myself still has a recipient', () => {
    expect(replyAllRecipients({ from: [a('carol@x.test')], to: [a('carol@x.test')], cc: [] }, 'carol@x.test').to).toEqual(['carol@x.test']);
  });

  it('does not stack prefixes', () => {
    expect(replySubject('Re: Lunch')).toBe('Re: Lunch');
    expect(replySubject('Lunch')).toBe('Re: Lunch');
    expect(forwardSubject('FW: Lunch')).toBe('FW: Lunch');
    expect(forwardSubject('Lunch')).toBe('Fwd: Lunch');
  });

  it('avatar letter and a stable hue', () => {
    expect(avatarOf(a('dave@x.test', 'Dave')).letter).toBe('D');
    expect(avatarOf(a('dave@x.test')).hue).toBe(avatarOf(a('DAVE@x.test', 'Someone')).hue);
    expect(avatarOf(undefined).letter).toBe('?');
  });

  it('short dates: time today, no year this year, year for older mail', () => {
    const now = new Date('2026-11-12T15:00:00');
    expect(shortDate('2026-11-12T09:30:00', now)).toMatch(/\d{1,2}[:.]\d{2}/);
    expect(shortDate('2026-03-02T09:30:00', now)).not.toMatch(/2026/);
    expect(shortDate('2024-03-02T09:30:00', now)).toMatch(/2024/);
    expect(shortDate(null, now)).toBe('');
    expect(shortDate('not a date', now)).toBe('');
  });

  it('uses the time zone from preferences to decide what "today" is', () => {
    const now = new Date('2026-11-13T01:00:00Z'); // 06:00 on 13 Nov in Karachi, 01:00 in London
    try {
      setDisplayTimeZone('Asia/Karachi');
      expect(shortDate('2026-11-12T22:30:00Z', now)).toMatch(/03[:.]30/); // 03:30 on 13 Nov: today, so a time
      setDisplayTimeZone('Europe/London');
      expect(shortDate('2026-11-12T22:30:00Z', now)).not.toMatch(/[:.]/); // 12 Nov: yesterday, so a date
    } finally {
      setDisplayTimeZone('auto');
    }
  });
});

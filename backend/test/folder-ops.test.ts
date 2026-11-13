import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { encodeMessageId } from '../src/mail/message-id';
import { MAX_BULK, isProtectedFolder, parseBulk, validateFolderName } from '../src/mail/folder-ops';

describe('folder names (FOX-038)', () => {
  it('accepts ordinary names, including spaces and other scripts', () => {
    expect(validateFolderName('  Work ', '/')).toBe('Work');
    expect(validateFolderName('Client projects 2026', '.')).toBe('Client projects 2026');
    expect(validateFolderName('عمل', '/')).toBe('عمل');
  });

  it('refuses empty, too long, control characters, the hierarchy delimiter and IMAP wildcards', () => {
    for (const [name, delim] of [
      ['', '/'], ['   ', '/'], ['x'.repeat(101), '/'], ['a\r\nb', '/'], ['a/b', '/'], ['a.b', '.'],
      ['a*b', '/'], ['a%b', '/'], ['a/b', '.'], ['INBOX', '/'], ['inbox', '.'], [42, '/'],
    ] as [unknown, string][]) {
      expect(() => validateFolderName(name, delim), String(name)).toThrow(BadRequestException);
    }
  });

  it('protects the inbox and every folder with a role', () => {
    expect(isProtectedFolder({ path: 'INBOX', specialUse: '\\Inbox' })).toBe(true);
    expect(isProtectedFolder({ path: 'Sent', specialUse: '\\Sent' })).toBe(true);
    expect(isProtectedFolder({ path: 'Archive', specialUse: '\\Archive' })).toBe(true);
    expect(isProtectedFolder({ path: 'INBOX', specialUse: undefined })).toBe(true);
    expect(isProtectedFolder({ path: 'INBOX/Work', specialUse: undefined })).toBe(false);
  });
});

describe('bulk actions (FOX-037)', () => {
  const id = (uid: number, folder = 'INBOX', v = 7) => encodeMessageId(folder, v, uid);

  it('accepts ids from one folder and returns their UIDs', () => {
    expect(parseBulk({ ids: [id(3), id(9), id(3)], action: 'seen' })).toEqual({ folder: 'INBOX', uidValidity: 7n, uids: [3, 9], action: 'seen', target: undefined });
    expect(parseBulk({ ids: [id(1)], action: 'move', target: 'INBOX/Work' }).target).toBe('INBOX/Work');
  });

  it('refuses mixed folders, unknown actions, a move without a target and too many ids', () => {
    expect(() => parseBulk({ ids: [id(1), id(2, 'Sent')], action: 'seen' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: [id(1), id(2, 'INBOX', 8)], action: 'seen' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: [id(1)], action: 'expunge-all' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: [id(1)], action: 'move' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: [], action: 'seen' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: Array.from({ length: MAX_BULK + 1 }, (_, i) => id(i + 1)), action: 'seen' })).toThrow(BadRequestException);
    expect(() => parseBulk({ ids: ['not-an-id'], action: 'seen' })).toThrow(BadRequestException);
    expect(() => parseBulk(null)).toThrow(BadRequestException);
  });
});

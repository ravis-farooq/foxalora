import { describe, expect, it } from 'vitest';
import { saveSentCopy } from '../src/mail/sent-copy';

const box = (path: string, specialUse?: string) => ({ path, specialUse });

function fakeClient(boxes: { path: string; specialUse?: string }[], appendError?: Error) {
  const appended: { path: string; raw: string; flags?: string[] }[] = [];
  return {
    appended,
    list: async () => boxes,
    append: async (path: string, raw: Buffer, flags?: string[]) => {
      if (appendError) throw appendError;
      appended.push({ path, raw: raw.toString(), flags });
      return { destination: path };
    },
  };
}

describe('saveSentCopy (OPEN-4)', () => {
  it('appends the message to the folder marked \\Sent, already read', async () => {
    const c = fakeClient([box('INBOX', '\\Inbox'), box('Sent Items', '\\Sent'), box('Sent')]);
    expect(await saveSentCopy(c as never, Buffer.from('raw message'))).toBe('saved');
    expect(c.appended).toEqual([{ path: 'Sent Items', raw: 'raw message', flags: ['\\Seen'] }]);
  });

  it('reports a missing Sent folder instead of creating one', async () => {
    const c = fakeClient([box('INBOX', '\\Inbox'), box('Notes')]);
    expect(await saveSentCopy(c as never, Buffer.from('x'))).toBe('no_folder');
    expect(c.appended).toEqual([]);
  });

  it('lets append errors through, so the caller can say the copy failed', async () => {
    const c = fakeClient([box('Sent', '\\Sent')], new Error('NO quota exceeded'));
    await expect(saveSentCopy(c as never, Buffer.from('x'))).rejects.toThrow('quota');
  });
});

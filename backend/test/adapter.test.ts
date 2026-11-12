import { describe, expect, it } from 'vitest';
import { cleanDetails } from '../src/audit/audit.service';
import { normalizeMailError } from '../src/mail/mail-errors';
import { classifyParts } from '../src/mail/mail.service';
import { decodeMessageId, encodeMessageId } from '../src/mail/message-id';
import { SsrfError } from '../src/security/ssrf';

describe('opaque message ids (FOX-027)', () => {
  it('round-trips folder, UIDVALIDITY and UID, including non-ASCII folders', () => {
    for (const folder of ['INBOX', 'Archive/2026', 'Входящие', 'Sent Items']) {
      const id = encodeMessageId(folder, 1794472655n, 42);
      expect(id).toMatch(/^m1\.[A-Za-z0-9_-]+\.1794472655\.42$/);
      expect(decodeMessageId(id)).toEqual({ folder, uidValidity: 1794472655n, uid: 42 });
    }
  });

  it('rejects sequence numbers, malformed ids and out-of-range values', () => {
    for (const bad of ['42', 'm1.SU5CT1g.1.0', 'm1.SU5CT1g.0.1', 'm1.SU5CT1g.99999999999.1', 'm1.SU5CT1g.1.99999999999', 'm2.SU5CT1g.1.1', `m1.${Buffer.from('a\r\nb').toString('base64url')}.1.1`, undefined, 7])
      expect(() => decodeMessageId(bad), String(bad)).toThrow();
  });
});

describe('body structure classification (fetch policy, D1)', () => {
  const tree = {
    type: 'multipart/mixed',
    childNodes: [
      { type: 'multipart/alternative', childNodes: [{ part: '1.1', type: 'text/plain', size: 10 }, { part: '1.2', type: 'text/html', size: 20 }] },
      { part: '2', type: 'image/png', disposition: 'inline', id: '<logo@x>', size: 400, encoding: 'base64', parameters: { name: 'logo.png' } },
      { part: '3', type: 'application/pdf', disposition: 'attachment', dispositionParameters: { filename: '../../a‮fdp.exe' }, size: 8 },
      { part: '4', type: 'text/plain', disposition: 'attachment', dispositionParameters: { filename: 'notes.txt' }, size: 5 },
      { part: '5', type: 'message/rfc822', childNodes: [{ part: '5.1', type: 'text/plain' }] },
    ],
  };

  it('picks the first text and html bodies and lists everything else as attachments', () => {
    const r = classifyParts(tree as never);
    expect(r.text?.part).toBe('1.1');
    expect(r.html?.part).toBe('1.2');
    expect(r.attachments.map((a) => [a.part, a.filename, a.inline])).toEqual([
      ['2', 'logo.png', true],
      ['3', 'afdp.exe', false],
      ['4', 'notes.txt', false],
      ['5', 'attachment-5', false],
    ]);
    expect(r.attachments[0].contentId).toBe('logo@x');
    expect(r.attachments[0].size).toBe(300); // base64 size converted to decoded size
  });

  it('handles a single-part message (no part number)', () => {
    expect(classifyParts({ type: 'text/plain' } as never).text?.part).toBe('1');
  });
});

describe('adapter error normalisation (FOX-028)', () => {
  const cases: Array<[unknown, string, number]> = [
    [{ authenticationFailed: true, responseText: 'secret detail' }, 'mail_auth_failed', 401],
    [{ code: 'EAUTH', response: '535 auth failed for alice' }, 'mail_auth_failed', 401],
    [{ code: 'ECONNREFUSED' }, 'mail_server_unavailable', 502],
    [{ code: 'ETIMEDOUT' }, 'mail_server_timeout', 504],
    [{ code: 'CERT_HAS_EXPIRED' }, 'mail_server_tls_error', 502],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'mail_server_tls_error', 502],
    [{ mailboxMissing: true }, 'folder_not_found', 404],
    [{ code: 'EENVELOPE', response: '550 <bob@x> no such user' }, 'recipient_rejected', 400],
    [{ responseStatus: 'NO', executedCommand: 'A1 SELECT Private' }, 'mail_protocol_error', 502],
    [new SsrfError('destination not allowed'), 'mail_server_unavailable', 502],
    [new Error('weird'), 'mail_error', 502],
  ];
  it.each(cases)('%j -> %s', (input, code, status) => {
    const e = normalizeMailError(input) as { code: string; getStatus(): number; message: string };
    expect(e.code).toBe(code);
    expect(e.getStatus()).toBe(status);
    expect(e.message).not.toMatch(/secret|alice|bob|Private|535|550/);
  });
});

describe('audit details', () => {
  it('drops secret-looking keys and non-primitive values', () => {
    expect(cleanDetails({ ip: '198.51.100.7', password: 'x', apiToken: 'y', sessionId: 'z', subject: 'hi', body: 'b', nested: { a: 1 }, n: 3, ok: true })).toEqual({ ip: '198.51.100.7', n: 3, ok: true });
  });
});

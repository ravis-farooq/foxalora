import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { buildDraftMime, buildSendMime, parseOutgoing } from '../src/mail/outgoing';

describe('parseOutgoing: messages to send', () => {
  it('accepts a normal message', () => {
    const m = parseOutgoing({ to: ['dave@x.test'], cc: [' erin@x.test '], subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' }, 'send');
    expect(m.to).toEqual(['dave@x.test']);
    expect(m.cc).toEqual(['erin@x.test']);
    expect(m.html).toContain('Hello');
  });

  it('refuses invalid or missing recipients and header injection in the subject', () => {
    expect(() => parseOutgoing({ to: [], subject: 'x' }, 'send')).toThrow(BadRequestException);
    expect(() => parseOutgoing({ to: ['not an address'], subject: 'x' }, 'send')).toThrow(BadRequestException);
    expect(() => parseOutgoing({ to: ['a@b.test\r\nBcc: evil@x.test'], subject: 'x' }, 'send')).toThrow(BadRequestException);
    expect(() => parseOutgoing({ to: ['a@b.test'], subject: 'Hi\r\nBcc: evil@x.test' }, 'send')).toThrow(BadRequestException);
    expect(() => parseOutgoing({ to: 'a@b.test', subject: 'x' } as never, 'send')).toThrow(BadRequestException);
  });
});

describe('parseOutgoing: drafts', () => {
  it('allows no recipients and an empty subject, and drops half-typed addresses', () => {
    const d = parseOutgoing({ to: ['dav', 'dave@x.test'], subject: '' }, 'draft');
    expect(d.to).toEqual(['dave@x.test']);
    expect(d.subject).toBe('');
  });

  it('still refuses header injection and cleans the HTML', () => {
    expect(() => parseOutgoing({ subject: 'x\nBcc: evil@x.test' }, 'draft')).toThrow(BadRequestException);
    const html = parseOutgoing({ html: '<p>ok</p><script>alert(1)</script><img src="https://t.example/p.gif">' }, 'draft').html;
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/\ssrc="https:\/\/t\.example/); // remote image kept only as a blocked placeholder
  });
});

describe('buildDraftMime', () => {
  it('builds a message from the mailbox address with the draft content', async () => {
    const d = parseOutgoing({ to: ['dave@x.test'], subject: 'Plan', text: 'Draft text', html: '<p>Draft text</p>' }, 'draft');
    const { raw, messageId } = await buildDraftMime('carol@x.test', 'Carol Smith', d);
    const s = raw.toString('utf8');
    expect(s).toMatch(/^From: Carol Smith <carol@x\.test>$/m);
    expect(s).toMatch(/^To: dave@x\.test$/m);
    expect(s).toMatch(/^Subject: Plan$/m);
    expect(s).toContain('Draft text');
    expect(messageId).toMatch(/^<[^<>\s]+@x\.test>$/);
    expect(s).toContain(`Message-ID: ${messageId}`);
  });
});

describe('buildSendMime (one message for SMTP and the Sent folder, OPEN-4)', () => {
  it('builds the same message twice: without Bcc for sending, with Bcc for the Sent copy', async () => {
    const d = parseOutgoing({ to: ['dave@x.test'], bcc: ['boss@x.test'], subject: 'Report', text: 'Hello', html: '<p>Hello</p>' }, 'send');
    const m = await buildSendMime('carol@x.test', 'Carol Smith', d);
    const smtp = m.smtpRaw.toString('utf8');
    const copy = m.copyRaw.toString('utf8');
    const header = (raw: string, name: string) => new RegExp(`^${name}: (.*)$`, 'mi').exec(raw)?.[1];
    expect(header(smtp, 'Message-ID')).toBe(m.messageId);
    expect(header(copy, 'Message-ID')).toBe(m.messageId);
    expect(header(copy, 'Date')).toBe(header(smtp, 'Date'));
    expect(header(smtp, 'From')).toBe('Carol Smith <carol@x.test>');
    expect(header(smtp, 'Bcc')).toBeUndefined(); // recipients must not see Bcc
    expect(header(copy, 'Bcc')).toBe('boss@x.test'); // the sender's own copy keeps it
    expect(m.envelope).toEqual({ from: 'carol@x.test', to: ['dave@x.test', 'boss@x.test'] });
    expect(m.messageId).toMatch(/^<[^<>\s]+@x\.test>$/);
  });
});

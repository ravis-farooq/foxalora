import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MAX_EMAILS_PER_CONTACT, parseContactInput } from '../src/contacts/contact-input';
import { parseVCards, toVCard } from '../src/contacts/vcard';

describe('parseContactInput (FOX-072)', () => {
  it('trims fields and keeps several addresses with labels', () => {
    expect(parseContactInput({ displayName: '  Dave Lee ', company: 'Example Hosting', phone: '+44 20 7946 0000', emails: [{ email: ' dave@x.test ', label: 'work' }, 'dave@home.test'] })).toEqual({
      displayName: 'Dave Lee', company: 'Example Hosting', phone: '+44 20 7946 0000',
      emails: [{ email: 'dave@x.test', label: 'work' }, { email: 'dave@home.test', label: '' }],
    });
  });

  it('drops duplicate addresses regardless of case', () => {
    expect(parseContactInput({ emails: ['Dave@X.test', 'dave@x.test'] }).emails).toEqual([{ email: 'Dave@X.test', label: '' }]);
  });

  it('ignores fields it does not know, such as a tenant or mailbox in the body', () => {
    const c = parseContactInput({ displayName: 'A', tenantId: 'x', mailbox: 'other@x.test', id: 'y' }) as unknown as Record<string, unknown>;
    expect(Object.keys(c).sort()).toEqual(['company', 'displayName', 'emails', 'phone']);
  });

  it('needs a name or an address', () => {
    expect(() => parseContactInput({ company: 'Only a company' })).toThrow(BadRequestException);
  });

  it('refuses bad input', () => {
    const bad: unknown[] = [
      null, 'text', [], { displayName: 42 }, { displayName: 'x'.repeat(201) }, { phone: 'x'.repeat(51) },
      { displayName: 'A\r\nBcc: evil@x.test' }, { emails: ['not-an-address'] }, { emails: ['a@b.test\r\n'] },
      { emails: 'a@b.test' }, { emails: Array.from({ length: MAX_EMAILS_PER_CONTACT + 1 }, (_, i) => `a${i}@b.test`) },
      { emails: [{ email: 'a@b.test', label: 'x'.repeat(51) }] }, { emails: [`${'a'.repeat(320)}@b.test`] },
    ];
    for (const b of bad) expect(() => parseContactInput(b), JSON.stringify(b)?.slice(0, 60)).toThrow(BadRequestException);
  });
});

describe('vCard import and export (FOX-075)', () => {
  it('reads vCard 3.0 with folded lines, escapes and typed emails', () => {
    const vcf = [
      'BEGIN:VCARD', 'VERSION:3.0', 'N:Lee;Dave;;;', 'FN:Dave Lee', 'ORG:Example Hosting\\, Ltd;Support',
      'TEL;TYPE=WORK,VOICE:+44 20 7946 0000', 'EMAIL;TYPE=INTERNET;TYPE=WORK:dave@x.test',
      'EMAIL;TYPE=HOME:dave@ho', ' me.test', 'NOTE:ignored', 'END:VCARD',
    ].join('\r\n');
    const r = parseVCards(vcf);
    expect(r.errors).toEqual([]);
    expect(r.contacts).toEqual([{
      displayName: 'Dave Lee', company: 'Example Hosting, Ltd', phone: '+44 20 7946 0000',
      emails: [{ email: 'dave@x.test', label: 'work' }, { email: 'dave@home.test', label: 'home' }],
    }]);
  });

  it('reads vCard 4.0, grouped properties, a name from N only, and several cards', () => {
    const vcf = 'BEGIN:VCARD\nVERSION:4.0\nN:Doe;Erin;;;\nitem1.EMAIL;TYPE="work,pref":erin@x.test\nEND:VCARD\nBEGIN:VCARD\nVERSION:4.0\nFN:مرحبا كارول\nEMAIL:carol@x.test\nEND:VCARD\n';
    expect(parseVCards(vcf).contacts).toEqual([
      { displayName: 'Erin Doe', company: '', phone: '', emails: [{ email: 'erin@x.test', label: 'work' }] },
      { displayName: 'مرحبا كارول', company: '', phone: '', emails: [{ email: 'carol@x.test', label: '' }] },
    ]);
  });

  it('decodes vCard 2.1 quoted-printable names', () => {
    const vcf = 'BEGIN:VCARD\r\nVERSION:2.1\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Gr=C3=BC=C3=9Fe Team\r\nEMAIL;INTERNET:team@x.test\r\nEND:VCARD';
    expect(parseVCards(vcf).contacts[0].displayName).toBe('Grüße Team');
  });

  it('keeps valid cards and lists the invalid ones', () => {
    const vcf = 'BEGIN:VCARD\nFN:Good\nEMAIL:good@x.test\nEND:VCARD\nBEGIN:VCARD\nFN:Bad\nEMAIL:not an address\nEND:VCARD\nBEGIN:VCARD\nNOTE:nothing useful\nEND:VCARD';
    const r = parseVCards(vcf);
    expect(r.contacts.map((c) => c.displayName)).toEqual(['Good']);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/^Contact 2/);
  });

  it('round trip keeps names, companies, phones and addresses', () => {
    const contacts = [
      { displayName: 'Dave; "The Boss", Lee', company: 'A, B; C', phone: '+1 555', emails: [{ email: 'dave@x.test', label: 'work' }, { email: 'd@y.test', label: '' }] },
      { displayName: 'مرحبا كارول '.repeat(8).trim(), company: '', phone: '', emails: [{ email: 'carol@x.test', label: 'home' }] },
    ];
    const vcf = toVCard(contacts);
    expect(vcf.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(vcf).toContain('VERSION:3.0');
    expect(parseVCards(vcf)).toEqual({ contacts, errors: [] });
  });

  it('refuses huge input instead of parsing it', () => {
    expect(() => parseVCards('x'.repeat(2_000_001))).toThrow(BadRequestException);
  });
});

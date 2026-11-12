import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, parsePreferencesPatch, withDefaults } from '../src/preferences/preferences';
import { cleanSignature, MAX_SIGNATURE_BYTES, parseSignatureInput } from '../src/preferences/signature-content';

describe('preferences (FOX-077)', () => {
  it('accepts a valid partial update', () => {
    expect(parsePreferencesPatch({ displayName: '  Carol Smith ', theme: 'dark', density: 'compact', timeZone: 'Asia/Karachi' }))
      .toEqual({ displayName: 'Carol Smith', theme: 'dark', density: 'compact', timeZone: 'Asia/Karachi' });
    expect(parsePreferencesPatch({ timeZone: 'auto' })).toEqual({ timeZone: 'auto' });
    expect(parsePreferencesPatch({ timeZone: 'UTC' })).toEqual({ timeZone: 'UTC' });
  });

  it('refuses unknown keys and invalid values', () => {
    const bad: unknown[] = [
      null, [], 'x', { theme: 'pink' }, { density: 1 }, { timeZone: 'Mars/Base' }, { colour: 'red' },
      { displayName: 'x'.repeat(101) }, { displayName: 'Carol\r\nBcc: x@y.test' },
      // A display name that looks like an address would mislead recipients.
      { displayName: 'PayPal <security@paypal.com>' }, { __proto__: { theme: 'dark' }, polluted: true },
    ];
    for (const b of bad) expect(() => parsePreferencesPatch(b), JSON.stringify(b)).toThrow(BadRequestException);
  });

  it('fills defaults and ignores stored values that are no longer valid', () => {
    expect(withDefaults({})).toEqual(DEFAULT_PREFERENCES);
    expect(withDefaults({ theme: 'dark', density: 'huge', removed: 1 })).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark' });
  });
});

describe('signatures (FOX-079)', () => {
  const doc = (...content: object[]) => ({ type: 'doc', content });
  const p = (...content: object[]) => ({ type: 'paragraph', content });
  const t = (text: string, marks?: object[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) });

  it('keeps email-safe formatting', () => {
    const d = doc(p(t('Carol', [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#c2410c', fontFamily: 'Georgia, serif', fontSize: '16px' } }])), { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('Support', [{ type: 'link', attrs: { href: 'https://example.com/help' } }])] });
    expect(cleanSignature(d)).toEqual(d);
  });

  it('removes scripts, unsafe links, images, unknown nodes and attributes', () => {
    const dirty = doc(
      p(t('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]), t('y', [{ type: 'evil' }])),
      { type: 'image', attrs: { src: 'https://tracker.example/p.gif' } },
      { type: 'script', content: [t('alert(1)')] },
      { type: 'paragraph', attrs: { onclick: 'alert(1)', textAlign: 'center', style: 'background:url(x)' }, content: [t('z', [{ type: 'textStyle', attrs: { color: 'expression(alert(1))' } }])] },
    );
    expect(cleanSignature(dirty)).toEqual(doc(p(t('x'), t('y')), { type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('z')] }));
  });

  it('accepts mailto and tel links but not data: or protocol-relative ones', () => {
    const link = (href: string) => cleanSignature(doc(p(t('a', [{ type: 'link', attrs: { href } }]))));
    expect(JSON.stringify(link('mailto:carol@x.test'))).toContain('mailto:');
    expect(JSON.stringify(link('tel:+44123'))).toContain('tel:');
    for (const href of ['data:text/html,x', '//evil.example', 'vbscript:x', ' javascript:x']) expect(JSON.stringify(link(href))).not.toContain('link');
  });

  it('validates name, size, nesting and the default flag', () => {
    expect(parseSignatureInput({ name: ' Work ', content: doc(p(t('Carol'))), isDefault: true })).toEqual({ name: 'Work', content: doc(p(t('Carol'))), isDefault: true });
    const bad: unknown[] = [
      { name: '', content: doc() }, { name: 'x'.repeat(101), content: doc() }, { name: 'A', content: 'text' },
      { name: 'A', content: { type: 'paragraph' } }, { name: 'A', content: doc(), isDefault: 'yes' },
      { name: 'A', content: doc(p(t('x'.repeat(MAX_SIGNATURE_BYTES)))) },
    ];
    for (const b of bad) expect(() => parseSignatureInput(b), JSON.stringify(b).slice(0, 60)).toThrow(BadRequestException);
    let deep: object = t('x');
    for (let i = 0; i < 40; i++) deep = { type: 'blockquote', content: [deep] };
    expect(() => parseSignatureInput({ name: 'A', content: doc(deep) })).toThrow(BadRequestException);
  });
});

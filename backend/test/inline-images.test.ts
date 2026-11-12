import { describe, expect, it } from 'vitest';
import { validateInlineImages } from '../src/mail/inline-images';

// Smallest valid images of each allowed type (magic bytes are what matters).
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);
const cid = (n: number) => `0b1a2c3d-4e5f-4a6b-8c7d-${String(n).padStart(12, '0')}@foxalora`;
const img = (n: number, data: Buffer, contentType = 'image/png', filename = 'a.png') => ({ contentId: cid(n), filename, contentType, data: data.toString('base64') });
const html = (...ns: number[]) => ns.map((n) => `<img src="cid:${cid(n)}">`).join('');

describe('inline images on send (rule 11)', () => {
  it('accepts valid PNG, JPEG, GIF and WebP images that the HTML references', () => {
    const out = validateInlineImages(
      [img(1, PNG), img(2, JPEG, 'image/jpeg', 'b.jpg'), img(3, GIF, 'image/gif', 'c.gif'), img(4, WEBP, 'image/webp', 'd.webp')],
      html(1, 2, 3, 4),
    );
    expect(out.map((a) => [a.cid, a.contentType, a.content.length > 0])).toEqual([
      [cid(1), 'image/png', true], [cid(2), 'image/jpeg', true], [cid(3), 'image/gif', true], [cid(4), 'image/webp', true],
    ]);
    expect(out.every((a) => a.contentDisposition === 'inline')).toBe(true);
  });

  it('uses the sniffed type, not the declared one, and refuses non-images', () => {
    expect(() => validateInlineImages([img(1, PNG, 'image/jpeg')], html(1))).toThrow(/does not match/);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect(() => validateInlineImages([img(1, svg, 'image/png')], html(1))).toThrow(/not a supported image/);
    expect(() => validateInlineImages([img(1, Buffer.from('MZ\x90\x00'), 'image/png', 'x.exe')], html(1))).toThrow(/not a supported image/);
  });

  it('drops images the HTML does not reference and rejects bad content ids', () => {
    expect(validateInlineImages([img(1, PNG), img(2, PNG)], html(1)).map((a) => a.cid)).toEqual([cid(1)]);
    expect(() => validateInlineImages([{ ...img(1, PNG), contentId: 'x"><script>' }], '<img src="cid:x">')).toThrow(/content id/);
  });

  it('enforces count and size limits', () => {
    const many = Array.from({ length: 11 }, (_, i) => img(i, PNG));
    expect(() => validateInlineImages(many, html(...many.map((_, i) => i)))).toThrow(/too many/);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => validateInlineImages([img(1, big)], html(1))).toThrow(/too large/);
  });

  it('cleans file names and rejects malformed input', () => {
    expect(validateInlineImages([img(1, PNG, 'image/png', '../../evil‮gnp.exe')], html(1))[0].filename).toBe('evilgnp.exe');
    expect(() => validateInlineImages('nope' as never, '')).toThrow(/list/);
    expect(() => validateInlineImages([{ contentId: cid(1) } as never], html(1))).toThrow();
    expect(validateInlineImages(undefined, '')).toEqual([]);
  });
});

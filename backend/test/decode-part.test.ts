import { describe, expect, it } from 'vitest';
import { decodePart } from '../src/mail/decode-part';

describe('decodePart (fallback when the server returns wrong part headers)', () => {
  it('decodes quoted-printable with soft line breaks as UTF-8', () => {
    const qp = Buffer.from('<div style=3D"font-family:Arial;line-=\r\nheight:1.5">Gr=C3=BC=C3=9Fe =E2=80=94 caf=C3=A9</div>', 'latin1');
    expect(decodePart(qp, 'quoted-printable', 'utf-8')).toBe('<div style="font-family:Arial;line-height:1.5">Grüße — café</div>');
  });

  it('decodes base64 in a legacy charset', () => {
    const b64 = Buffer.from(Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64')); // "café" in ISO-8859-1
    expect(decodePart(b64, 'base64', 'iso-8859-1')).toBe('café');
    expect(decodePart(Buffer.from('Y2Fmw6k=\r\n'), 'BASE64', 'UTF-8')).toBe('café');
  });

  it('passes 7bit/8bit through and falls back to UTF-8 for unknown charsets', () => {
    expect(decodePart(Buffer.from('plain'), '7bit', 'us-ascii')).toBe('plain');
    expect(decodePart(Buffer.from('café', 'utf8'), '8bit', 'x-made-up')).toBe('café');
    expect(decodePart(Buffer.from('café', 'utf8'), undefined, undefined)).toBe('café');
  });

  it('leaves invalid quoted-printable sequences as they are', () => {
    expect(decodePart(Buffer.from('100%=ZZ ok'), 'quoted-printable', 'utf-8')).toBe('100%=ZZ ok');
  });
});

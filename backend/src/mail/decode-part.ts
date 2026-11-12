/**
 * Decodes a body part from its BODYSTRUCTURE encoding and charset.
 * Used when the server answers BODY[part.MIME] with the wrong headers (seen on
 * GreenMail for parts nested in multipart/related), so imapflow cannot decode it.
 */
function decodeQuotedPrintable(raw: Buffer): Buffer {
  const s = raw.toString('latin1').replace(/=\r?\n/g, ''); // soft line breaks
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const hex = s[i] === '=' ? s.slice(i + 1, i + 3) : '';
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

export function decodePart(raw: Buffer, encoding: string | undefined, charset: string | undefined): string {
  const enc = (encoding ?? '').toLowerCase();
  const bytes =
    enc === 'base64' ? Buffer.from(raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')
    : enc === 'quoted-printable' ? decodeQuotedPrintable(raw)
    : raw;
  try {
    return new TextDecoder((charset ?? 'utf-8').toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes); // unknown charset label
  }
}

// Bidi controls can disguise a file type ("invoice‮fdp.exe" displays as "invoiceexe.pdf").
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const UNSAFE_CHARS = /[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g;

/**
 * Attachment name safe to show and to offer as a download name: no directory
 * parts, no control or bidi-override characters, bounded length.
 */
export function safeFilename(name: unknown, fallback = 'attachment'): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(UNSAFE_CHARS, '').replace(/^\.+/, '').trim().slice(0, 150);
  return clean || fallback;
}

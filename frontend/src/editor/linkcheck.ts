import { safeHref } from './allowlist';

const host = (href: string) => {
  try {
    const u = new URL(href);
    return u.protocol === 'mailto:' ? u.pathname.split('@')[1]?.toLowerCase() ?? '' : u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/**
 * True when the visible text looks like an address but points somewhere else,
 * e.g. text "paypal.com" linking to https://evil.example. Used by the composer's
 * link menu and reusable by the viewer's link warning (FOX-047).
 */
export function linkTextMismatch(text: string, href: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t) || !/[.@]/.test(t)) return false;
  const shown = t.includes('@') && !t.includes('/') ? `mailto:${t}` : safeHref(t);
  if (!shown) return false;
  const a = host(shown);
  const b = host(href);
  return !!a && !!b && a !== b;
}

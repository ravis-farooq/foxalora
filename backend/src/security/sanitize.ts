import DOMPurify from 'isomorphic-dompurify';

/**
 * HTML email sanitization (PRD 3 Module 3 + 5.4).
 * This is defence layer 1. Layer 2 is the sandboxed iframe + CSP in the
 * frontend. Layer 3 (production) is serving that iframe from a separate origin.
 */
const ALLOWED_PROTOCOLS = /^(https?:|mailto:|tel:|cid:|data:image\/(png|jpe?g|gif|webp);base64,)/i;

const REMOTE_CSS = /url\s*\(|image-set\s*\(|expression\s*\(|@import|\bsrc\s*\(/i;

/** Decodes CSS escapes (\72, \000072 , \u) so checks see what the browser will parse. */
export function decodeCssEscapes(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    })
    .replace(/\\(.)/g, '$1');
}

let configured = false;
function configure() {
  if (configured) return;
  configured = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node: any) => {
    // Links: always open in new tab, never leak referrer/opener
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!ALLOWED_PROTOCOLS.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer nofollow');
    }
    // Remote images blocked by default (tracking pixels). Keep a marker so the
    // UI can offer "Load remote images" later.
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (/^https?:/i.test(src)) {
        node.setAttribute('data-blocked-src', src);
        node.removeAttribute('src');
        node.setAttribute('alt', node.getAttribute('alt') || '[remote image blocked]');
      } else if (!ALLOWED_PROTOCOLS.test(src)) {
        node.removeAttribute('src');
      }
      node.removeAttribute('srcset');
    }
    // Strip inline styles that can load remote content (tracking/exfil). CSS escapes
    // are decoded first, otherwise "u\72l(" slips past as url( (Roundcube CVE class).
    const style = node.getAttribute?.('style');
    if (style && REMOTE_CSS.test(decodeCssEscapes(style))) {
      node.removeAttribute('style');
    }
  });
}

export function sanitizeEmailHtml(html: string): string {
  configure();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
      'form', 'input', 'button', 'textarea', 'select', 'option',
      'svg', 'math', 'link', 'meta', 'base', 'audio', 'video', 'source',
    ],
    FORBID_ATTR: ['srcset', 'formaction', 'action', 'background', 'ping'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: ALLOWED_PROTOCOLS,
  });
}

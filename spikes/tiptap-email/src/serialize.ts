import type { JSONContent } from '@tiptap/core';
import { DEFAULT_FONT, DEFAULT_SIZE, detectDir, fontSize, fontStack, INDENT_PX, isSafeColor, MAX_INDENT, safeHref } from './allowlist';

/**
 * Turns the editor's JSON document into what is actually sent: email-client-safe
 * HTML (inline styles, align/dir attributes, cid: images) and a plain-text part.
 * Works on JSON, not the DOM, so it runs on the server as well as in the browser.
 * The server must still sanitize the HTML with its outgoing-mail profile.
 */

export interface QuotedOriginal {
  /** e.g. "On 12 Nov 2026, Alice <alice@example.com> wrote:" */
  header: string;
  /** The original message HTML, already sanitized by the server. Inserted as-is. */
  html: string;
  /** The original message as plain text. */
  text: string;
}

export interface SerializeContext {
  signatures?: Record<string, JSONContent>;
  quoted?: QuotedOriginal;
  /** Images whose content id the composer did not create are dropped. */
  isKnownImage?: (contentId: string) => boolean;
  /** Email output for extra node types added through emailExtensions({ extra }). */
  nodes?: Record<string, NodeSerializer>;
}

/** Writes one custom block. Use `w` to render children so escaping and allowlists apply. */
export interface NodeSerializer {
  html: (node: JSONContent, w: WriterApi) => string;
  text: (node: JSONContent, w: WriterApi) => string[];
}

export interface WriterApi {
  blocks(nodes?: JSONContent[]): string;
  inline(nodes?: JSONContent[]): string;
  textBlocks(nodes?: JSONContent[]): string[];
  textInline(nodes?: JSONContent[]): string;
  escape(s: string): string;
}

export interface EmailOutput {
  html: string;
  text: string;
  /** Content ids referenced as cid: images; the sender attaches exactly these. */
  contentIds: string[];
}

const LINK_STYLE = 'color:#1a73e8;text-decoration:underline';
const HEADING_SIZE: Record<number, string> = { 1: '24px', 2: '20px', 3: '16px' };

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textOf(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

function dirOf(node: JSONContent): 'rtl' | 'ltr' | null {
  const d = node.attrs?.dir;
  return d === 'rtl' || d === 'ltr' ? d : detectDir(textOf(node));
}

/** style/align/dir attributes for a block. Outlook ignores CSS alignment on some
 * elements, so the legacy align attribute is emitted as well. */
function blockAttrs(node: JSONContent, baseStyle: string): string {
  const dir = dirOf(node);
  const set = node.attrs?.textAlign;
  const align = ['left', 'center', 'right', 'justify'].includes(set) ? set : dir === 'rtl' ? 'right' : null;
  const indent = Math.min(MAX_INDENT, Math.max(0, Number(node.attrs?.indent) || 0));
  const indented = indent ? `${baseStyle};margin-${dir === 'rtl' ? 'right' : 'left'}:${indent * INDENT_PX}px` : baseStyle;
  const style = align && !(align === 'left' && dir !== 'rtl') ? `${indented};text-align:${align}` : indented;
  let out = ` style="${style}"`;
  if (align && style !== indented) out += ` align="${align}"`;
  if (dir === 'rtl') out += ' dir="rtl"';
  return out;
}

const INLINE_TYPES = new Set(['text', 'hardBreak', 'image']);
const isInlineContent = (n: JSONContent) => !!n.content?.length && n.content.every((c) => INLINE_TYPES.has(c.type ?? ''));

const CELL_STYLE ='border:1px solid #cccccc;padding:6px;vertical-align:top';

class Writer implements WriterApi {
  escape = esc;
  contentIds = new Set<string>();
  constructor(private ctx: SerializeContext) {}

  // ---------- HTML ----------

  blocks(nodes: JSONContent[] = []): string {
    return nodes.map((n) => this.block(n)).join('');
  }

  block(node: JSONContent): string {
    const custom = node.type ? this.ctx.nodes?.[node.type] : undefined;
    if (custom) return custom.html(node, this);
    switch (node.type) {
      case 'table':
        return this.table(node);
      case 'paragraph':
        // Gmail-style: one div per line, no margins, <br> for an empty line.
        return `<div${blockAttrs(node, 'margin:0')}>${this.inline(node.content) || '<br>'}</div>`;
      case 'heading': {
        const size = HEADING_SIZE[node.attrs?.level] ?? HEADING_SIZE[3];
        const tag = `h${HEADING_SIZE[node.attrs?.level] ? node.attrs?.level : 3}`;
        return `<${tag}${blockAttrs(node, `margin:0 0 8px 0;font-size:${size};font-weight:bold;line-height:1.3`)}>${this.inline(node.content)}</${tag}>`;
      }
      case 'bulletList':
      case 'orderedList': {
        const rtl = dirOf(node) === 'rtl';
        const tag = node.type === 'bulletList' ? 'ul' : 'ol';
        const start = tag === 'ol' && Number.isInteger(node.attrs?.start) && node.attrs?.start !== 1 ? ` start="${node.attrs?.start}"` : '';
        const margin = rtl ? 'margin:0 28px 0 0;padding:0' : 'margin:0 0 0 28px;padding:0';
        return `<${tag}${start} style="${margin}"${rtl ? ' dir="rtl"' : ''}>${(node.content ?? []).map((li) => this.listItem(li)).join('')}</${tag}>`;
      }
      case 'blockquote': {
        const rtl = dirOf(node) === 'rtl';
        const side = rtl ? 'right' : 'left';
        return `<blockquote style="margin:0 0 0 0;margin-${side}:0.8ex;border-${side}:2px solid #cccccc;padding-${side}:1ex"${rtl ? ' dir="rtl"' : ''}>${this.blocks(node.content)}</blockquote>`;
      }
      case 'horizontalRule':
        return '<hr style="border:0;border-top:1px solid #cccccc;margin:12px 0">';
      case 'emailSignature': {
        const sig = this.ctx.signatures?.[node.attrs?.signatureId];
        return sig ? `<div style="margin:12px 0 0 0">${this.blocks(sig.content)}</div>` : '';
      }
      default:
        // Unknown blocks are written as plain lines so their text never silently vanishes.
        if (isInlineContent(node)) return `<div style="margin:0">${this.inline(node.content) || '<br>'}</div>`;
        return node.content ? this.blocks(node.content) : '';
    }
  }

  /** Real data table: border/cellpadding attributes for clients that ignore CSS. */
  table(node: JSONContent): string {
    const rtl = dirOf(node) === 'rtl';
    const rows = (node.content ?? []).map((tr) => {
      const cells = (tr.content ?? []).map((cell) => {
        const tag = cell.type === 'tableHeader' ? 'th' : 'td';
        const span = (k: string) => (Number.isInteger(cell.attrs?.[k]) && cell.attrs?.[k] > 1 ? ` ${k}="${cell.attrs?.[k]}"` : '');
        const width = Array.isArray(cell.attrs?.colwidth) && Number.isInteger(cell.attrs?.colwidth[0]) ? ` width="${cell.attrs?.colwidth[0]}"` : '';
        const [first, ...rest] = cell.content ?? [];
        const plainFirst = first?.type === 'paragraph' && !first.attrs?.textAlign && !first.attrs?.dir && !first.attrs?.indent;
        const body = (plainFirst ? this.inline(first.content) : first ? this.block(first) : '') + this.blocks(rest);
        const align = tag === 'th' ? `;text-align:${rtl ? 'right' : 'left'};font-weight:bold` : '';
        return `<${tag}${span('colspan')}${span('rowspan')}${width} style="${CELL_STYLE}${align}">${body || '&nbsp;'}</${tag}>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return (
      `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border:1px solid #cccccc;margin:8px 0"${rtl ? ' dir="rtl"' : ''}>` +
      `<tbody>${rows.join('')}</tbody></table>`
    );
  }

  listItem(li: JSONContent): string {
    const [first, ...rest] = li.content ?? [];
    // A plain first paragraph is written inline so clients don't add extra spacing.
    const plainFirst = first?.type === 'paragraph' && !first.attrs?.textAlign && !first.attrs?.dir;
    const head = plainFirst ? this.inline(first.content) : first ? this.block(first) : '';
    return `<li style="margin:0">${head}${this.blocks(rest)}</li>`;
  }

  inline(nodes: JSONContent[] = []): string {
    return nodes.map((n) => this.inlineNode(n)).join('');
  }

  inlineNode(node: JSONContent): string {
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'image') return this.image(node);
    if (node.type !== 'text') return '';
    let html = esc(node.text ?? '');
    const marks = node.marks ?? [];
    // Apply innermost first so the first mark ends up outermost.
    for (const mark of [...marks].reverse()) html = this.mark(mark, html);
    return html;
  }

  mark(mark: { type: string; attrs?: Record<string, any> }, inner: string): string {
    switch (mark.type) {
      case 'bold':
        return `<strong>${inner}</strong>`;
      case 'italic':
        return `<em>${inner}</em>`;
      case 'underline':
        return `<u>${inner}</u>`;
      case 'strike':
        return `<s>${inner}</s>`;
      case 'link': {
        const href = safeHref(mark.attrs?.href);
        return href ? `<a href="${esc(href)}" style="${LINK_STYLE}">${inner}</a>` : inner;
      }
      case 'textStyle': {
        const styles: string[] = [];
        if (isSafeColor(mark.attrs?.color)) styles.push(`color:${mark.attrs?.color}`);
        if (isSafeColor(mark.attrs?.backgroundColor)) styles.push(`background-color:${mark.attrs?.backgroundColor}`);
        const family = fontStack(mark.attrs?.fontFamily);
        if (family) styles.push(`font-family:${family.replace(/"/g, "'")}`);
        const size = fontSize(mark.attrs?.fontSize);
        if (size) styles.push(`font-size:${size}`);
        return styles.length ? `<span style="${styles.join(';')}">${inner}</span>` : inner;
      }
      default:
        return inner;
    }
  }

  image(node: JSONContent): string {
    const cid = node.attrs?.contentId;
    if (typeof cid !== 'string' || !/^[\w.@-]+$/.test(cid)) return '';
    if (this.ctx.isKnownImage && !this.ctx.isKnownImage(cid)) return '';
    this.contentIds.add(cid);
    const dim = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const w = dim(node.attrs?.width);
    const h = dim(node.attrs?.height);
    return (
      `<img src="cid:${cid}" alt="${esc(String(node.attrs?.alt ?? ''))}"` +
      (w ? ` width="${w}"` : '') +
      (h ? ` height="${h}"` : '') +
      ' style="max-width:100%;height:auto;border:0;display:inline-block">'
    );
  }

  document(doc: JSONContent): string {
    const q = this.ctx.quoted;
    const quoted = q
      ? `<div style="margin:12px 0 0 0">${esc(q.header)}</div>` +
        `<blockquote type="cite" style="margin:0 0 0 0.8ex;border-left:2px solid #cccccc;padding-left:1ex">${q.html}</blockquote>`
      : '';
    return (
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="margin:0;padding:0">' +
      `<div style="font-family:${DEFAULT_FONT};font-size:${DEFAULT_SIZE};line-height:1.5;color:#222222">` +
      `${this.blocks(doc.content)}${quoted}</div></body></html>`
    );
  }

  // ---------- plain text ----------

  textBlocks(nodes: JSONContent[] = []): string[] {
    return nodes.flatMap((n) => this.textBlock(n));
  }

  textBlock(node: JSONContent): string[] {
    const custom = node.type ? this.ctx.nodes?.[node.type] : undefined;
    if (custom) return custom.text(node, this);
    switch (node.type) {
      case 'paragraph':
      case 'heading': {
        const pad = '    '.repeat(Math.min(MAX_INDENT, Math.max(0, Number(node.attrs?.indent) || 0)));
        return this.textInline(node.content).split('\n').map((l) => pad + l);
      }
      case 'table':
        // One line per row, cells separated by " | ", a rule under a header row.
        return (node.content ?? []).flatMap((tr) => {
          const line = (tr.content ?? []).map((cell) => this.textBlocks(cell.content).join(' ').trim()).join(' | ');
          const header = (tr.content ?? []).every((c) => c.type === 'tableHeader');
          return header ? [line, '-'.repeat(Math.min(line.length, 60))] : [line];
        });
      case 'bulletList':
      case 'orderedList': {
        let n = Number.isInteger(node.attrs?.start) ? node.attrs?.start : 1;
        return (node.content ?? []).flatMap((li) => {
          const marker = node.type === 'bulletList' ? '- ' : `${n++}. `;
          const pad = ' '.repeat(marker.length);
          return this.textBlocks(li.content).map((line, i) => (i === 0 ? marker : pad) + line);
        });
      }
      case 'blockquote':
        return this.textBlocks(node.content).map((l) => (l ? `> ${l}` : '>'));
      case 'horizontalRule':
        return ['----------'];
      case 'emailSignature': {
        const sig = this.ctx.signatures?.[node.attrs?.signatureId];
        // RFC 3676 signature separator: dash, dash, space.
        return sig ? ['', '-- ', ...this.textBlocks(sig.content)] : [];
      }
      default:
        if (isInlineContent(node)) return this.textInline(node.content).split('\n');
        return node.content ? this.textBlocks(node.content) : [];
    }
  }

  /** Inline text; a link run shows as "text <url>" unless the text is the url. */
  textInline(nodes: JSONContent[] = []): string {
    let out = '';
    let run = '';
    let runHref: string | null = null;
    const flush = () => {
      if (runHref) {
        const bare = runHref.replace(/^mailto:/, '');
        out += run === runHref || run === bare ? run : `${run} <${bare}>`;
      } else out += run;
      run = '';
      runHref = null;
    };
    for (const n of nodes) {
      if (n.type === 'text') {
        const href = safeHref(n.marks?.find((m) => m.type === 'link')?.attrs?.href);
        if (href !== runHref) flush();
        runHref = href;
        run += n.text ?? '';
      } else {
        flush();
        if (n.type === 'hardBreak') out += '\n';
        else if (n.type === 'image' && n.attrs?.contentId && (this.ctx.isKnownImage?.(n.attrs.contentId) ?? true))
          out += `[image${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]`;
      }
    }
    flush();
    return out;
  }

  plain(doc: JSONContent): string {
    const lines = this.textBlocks(doc.content);
    const q = this.ctx.quoted;
    if (q) lines.push('', q.header, ...q.text.split(/\r?\n/).map((l) => (l ? `> ${l}` : '>')));
    // Trim trailing spaces except on the signature separator line.
    return lines.map((l) => (l === '-- ' ? l : l.replace(/[ \t ]+$/, ''))).join('\n').replace(/\n+$/, '') + '\n';
  }
}

const isBlank = (n: JSONContent) => n.type === 'paragraph' && !textOf(n).trim() && !(n.content ?? []).some((c) => c.type !== 'text');

/** Drops empty lines at the end of the typed text (before the signature, if any). */
function trimTrailingBlank(doc: JSONContent): JSONContent {
  const nodes = [...(doc.content ?? [])];
  const sigAt = nodes.findIndex((n) => n.type === 'emailSignature');
  let end = sigAt === -1 ? nodes.length : sigAt;
  let i = end;
  while (i > 0 && isBlank(nodes[i - 1])) i--;
  nodes.splice(i, end - i);
  return { ...doc, content: nodes };
}

export function serializeEmail(doc: JSONContent, ctx: SerializeContext = {}): EmailOutput {
  doc = trimTrailingBlank(doc);
  const w = new Writer(ctx);
  const html = w.document(doc);
  const text = w.plain(doc);
  return { html, text, contentIds: [...w.contentIds] };
}

import { BadRequestException } from '@nestjs/common';
import { sniff } from '../mail/inline-images';

/**
 * Signatures are stored as editor documents (Tiptap JSON) and cleaned on save (FOX-079):
 * only email-safe nodes, marks and attribute values are kept. Outgoing HTML is sanitized
 * again before sending, so this is the first of two layers.
 */
export const MAX_SIGNATURE_BYTES = 16_000;
export const MAX_SIGNATURES = 20;
/** Images are stored in the signature as data URIs, like Roundcube's identity_image_size (64 KB). */
export const MAX_SIGNATURE_IMAGE_BYTES = 64 * 1024;
export const MAX_SIGNATURE_IMAGES = 3;
// Formats every mail client shows. SVG can carry scripts and WebP is missing in Outlook.
const DATA_IMAGE = /^data:(image\/(?:png|jpeg|gif));base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_IMAGE_B64 = Math.ceil((MAX_SIGNATURE_IMAGE_BYTES * 4) / 3) + 4;
const MAX_DEPTH = 12;

type Json = Record<string, unknown>;
type AttrCheck = (v: unknown) => boolean;

const oneOf = (...vals: unknown[]): AttrCheck => (v) => vals.includes(v);
const intIn = (min: number, max: number): AttrCheck => (v) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const COLOR: AttrCheck = (v) => typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i.test(v);
const FONT: AttrCheck = (v) => typeof v === 'string' && /^[\w\s,'"-]{1,100}$/.test(v);
const SIZE: AttrCheck = (v) => typeof v === 'string' && /^\d{1,2}px$/.test(v);
const HREF: AttrCheck = (v) => typeof v === 'string' && /^(https?:\/\/|mailto:|tel:)[^\s<>"]{1,2000}$/i.test(v);

const BLOCK = { textAlign: oneOf('left', 'center', 'right', 'justify'), dir: oneOf('ltr', 'rtl'), indent: intIn(1, 4) };
const NODES: Record<string, Record<string, AttrCheck>> = {
  doc: {}, paragraph: BLOCK, heading: { ...BLOCK, level: intIn(1, 3) }, text: {}, hardBreak: {},
  bulletList: {}, orderedList: { start: intIn(1, 1000) }, listItem: {}, blockquote: {}, horizontalRule: {},
  table: {}, tableRow: {}, tableHeader: { colspan: intIn(1, 20), rowspan: intIn(1, 20) }, tableCell: { colspan: intIn(1, 20), rowspan: intIn(1, 20) },
};
const MARKS: Record<string, Record<string, AttrCheck>> = {
  bold: {}, italic: {}, underline: {}, strike: {},
  link: { href: HREF },
  textStyle: { color: COLOR, backgroundColor: COLOR, fontFamily: FONT, fontSize: SIZE },
};
/** Marks that mean nothing without their attributes. */
const NEEDS_ATTRS = new Set(['link', 'textStyle']);

function cleanAttrs(attrs: unknown, allowed: Record<string, AttrCheck>): Json | undefined {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const out: Json = {};
  for (const [k, check] of Object.entries(allowed)) {
    const v = (attrs as Json)[k];
    if (v !== null && v !== undefined && check(v)) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** A signature image: an inline data URI whose bytes really are PNG, JPEG or GIF. Anything else is dropped. */
function cleanImage(attrs: unknown, state: { images: number }): Json | null {
  const a = (attrs ?? {}) as Json;
  const m = typeof a.src === 'string' ? DATA_IMAGE.exec(a.src) : null;
  if (!m) return null; // remote, SVG, WebP or malformed
  if (m[2].length > MAX_IMAGE_B64) throw new BadRequestException('signature images can be up to 64 KB each');
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || sniff(bytes) !== m[1]) return null;
  if (bytes.length > MAX_SIGNATURE_IMAGE_BYTES) throw new BadRequestException('signature images can be up to 64 KB each');
  if (++state.images > MAX_SIGNATURE_IMAGES) throw new BadRequestException(`a signature can have at most ${MAX_SIGNATURE_IMAGES} images`);
  const out: Json = { src: a.src };
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
  if (typeof a.alt === 'string' && a.alt.length <= 200 && !/[\u0000-\u001f\u007f]/.test(a.alt)) out.alt = a.alt;
  for (const k of ['width', 'height'] as const) if (intIn(1, 2000)(a[k])) out[k] = a[k];
  return { type: 'image', attrs: out };
}

function cleanNode(node: unknown, depth: number, state: { images: number }): Json | null {
  if (depth > MAX_DEPTH) throw new BadRequestException('signature is nested too deeply');
  if (!node || typeof node !== 'object') return null;
  const n = node as Json;
  const type = n.type as string;
  if (type === 'image') return cleanImage(n.attrs, state);
  if (typeof type !== 'string' || !Object.hasOwn(NODES, type)) return null; // unknown: dropped with its content
  const out: Json = { type };
  const attrs = cleanAttrs(n.attrs, NODES[type]);
  if (attrs) out.attrs = attrs;
  if (type === 'text') {
    if (typeof n.text !== 'string' || !n.text) return null;
    out.text = n.text;
    const marks = (Array.isArray(n.marks) ? n.marks : [])
      .map((m: unknown) => {
        const mt = (m as Json)?.type as string;
        if (typeof mt !== 'string' || !Object.hasOwn(MARKS, mt)) return null;
        const ma = cleanAttrs((m as Json).attrs, MARKS[mt]);
        if (NEEDS_ATTRS.has(mt) && !ma) return null;
        return ma ? { type: mt, attrs: ma } : { type: mt };
      })
      .filter(Boolean);
    if (marks.length) out.marks = marks;
    return out;
  }
  if (Array.isArray(n.content)) out.content = n.content.map((c) => cleanNode(c, depth + 1, state)).filter(Boolean);
  return out;
}

export function cleanSignature(doc: unknown): Json {
  const clean = cleanNode(doc, 0, { images: 0 });
  if (!clean || clean.type !== 'doc') throw new BadRequestException('signature must be an editor document');
  return clean;
}

export interface SignatureInput { name: string; content: Json; isDefault: boolean }

export function parseSignatureInput(body: unknown): SignatureInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('invalid signature');
  const b = body as Json;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new BadRequestException('invalid signature name');
  if (b.isDefault !== undefined && typeof b.isDefault !== 'boolean') throw new BadRequestException('invalid default flag');
  // Cheap size guard before parsing: text allowance plus the largest allowed images.
  if (JSON.stringify(b.content ?? null).length > MAX_SIGNATURE_BYTES + MAX_SIGNATURE_IMAGES * (MAX_IMAGE_B64 + 200)) {
    throw new BadRequestException('signature is too long');
  }
  const content = cleanSignature(b.content);
  // The text and formatting stay within MAX_SIGNATURE_BYTES; images are limited separately.
  if (JSON.stringify(content, (k, v) => (k === 'src' ? '' : v)).length > MAX_SIGNATURE_BYTES) throw new BadRequestException('signature is too long');
  return { name, content, isDefault: b.isDefault === true };
}

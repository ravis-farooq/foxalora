import type { JSONContent } from '@tiptap/core';
import type { Signature } from './composer/EmailComposer';
import type { ImageStore } from './images';

/** Signature images (PNG, JPEG, GIF), checked again by the server when the signature is saved. */
export const SIGNATURE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif'];
export const MAX_SIGNATURE_IMAGE_BYTES = 64 * 1024;
export const MAX_SIGNATURE_IMAGES = 3;

export const countImages = (doc: JSONContent): number =>
  (doc.type === 'image' ? 1 : 0) + (doc.content ?? []).reduce((n, c) => n + countImages(c), 0);

/**
 * Signatures store their images as data URIs. For a message, each one is added to the
 * composer's image store, so it is sent as an inline (cid:) attachment like any other
 * inline image and validated on the server. Images that cannot be added are left out.
 */
export function withInlineSignatureImages(signatures: Record<string, Signature>, store: ImageStore): Record<string, Signature> {
  const convert = (node: JSONContent): JSONContent | null => {
    if (node.type === 'image') {
      const src = node.attrs?.src;
      if (typeof src !== 'string' || !src.startsWith('data:')) return null;
      const ext = /^data:image\/(png|jpeg|gif);/i.exec(src)?.[1].toLowerCase().replace('jpeg', 'jpg') ?? 'png';
      const base = String(node.attrs?.alt || 'signature-image').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'signature-image';
      const img = store.addDataUrl(src, `${base}.${ext}`);
      return img ? { ...node, attrs: { ...node.attrs, src: img.previewUrl, contentId: img.contentId } } : null;
    }
    if (!node.content) return node;
    return { ...node, content: node.content.map(convert).filter((n): n is JSONContent => n !== null) };
  };
  return Object.fromEntries(Object.entries(signatures).map(([id, s]) => [id, { ...s, content: convert(s.content) ?? { type: 'doc' } }]));
}

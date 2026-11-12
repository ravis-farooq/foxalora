import { IMAGE_TYPES, MAX_INLINE_IMAGE_BYTES } from './allowlist';

export interface InlineImage {
  contentId: string;
  previewUrl: string;
  blob: Blob;
  name: string;
}

/**
 * Inline images live here until the message is sent; the editor only holds a
 * blob: preview URL and the content id. On send, each id the serializer reports
 * is uploaded as an attachment with that Content-ID (validated again server-side).
 */
export class ImageStore {
  private images = new Map<string, InlineImage>();

  constructor(private createUrl: (b: Blob) => string = (b) => URL.createObjectURL(b)) {}

  add(blob: Blob, name = 'image'): InlineImage | null {
    if (!IMAGE_TYPES.includes(blob.type) || blob.size > MAX_INLINE_IMAGE_BYTES) return null;
    const contentId = `${crypto.randomUUID()}@foxalora`;
    const img = { contentId, previewUrl: this.createUrl(blob), blob, name };
    this.images.set(contentId, img);
    return img;
  }

  addDataUrl(dataUrl: string): InlineImage | null {
    const m = /^data:(image\/[a-z]+);base64,(.*)$/is.exec(dataUrl);
    if (!m) return null;
    try {
      const bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      return this.add(new Blob([bytes], { type: m[1].toLowerCase() }), 'pasted-image');
    } catch {
      return null;
    }
  }

  get(contentId: string): InlineImage | undefined {
    return this.images.get(contentId);
  }
}

import { BadRequestException } from '@nestjs/common';
import { safeFilename } from '../security/filename';

export interface InlineImageInput {
  contentId: string;
  filename: string;
  contentType: string;
  /** base64 */
  data: string;
}

export interface InlineAttachment {
  cid: string;
  filename: string;
  contentType: string;
  content: Buffer;
  contentDisposition: 'inline';
}

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
// Content ids created by the editor: <uuid>@foxalora.
const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@foxalora$/;

/** Detects the real image type from magic bytes; never trusts the declared type. */
function sniff(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Validates inline images sent with a message (CLAUDE.md rule 11): count and size
 * limits, sniffed type must be an allowed image and match the declared type, safe
 * file names, and only images the HTML references as cid: are attached.
 */
export function validateInlineImages(list: unknown, html: string): InlineAttachment[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new BadRequestException('inline images must be a list');
  if (list.length > MAX_IMAGES) throw new BadRequestException(`too many inline images (max ${MAX_IMAGES})`);

  let total = 0;
  const out: InlineAttachment[] = [];
  for (const raw of list as InlineImageInput[]) {
    if (!raw || typeof raw.contentId !== 'string' || !CONTENT_ID.test(raw.contentId)) throw new BadRequestException('invalid inline image content id');
    if (typeof raw.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw.data)) throw new BadRequestException('invalid inline image data');
    if (raw.data.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4) throw new BadRequestException('inline image too large (max 5 MB)');
    const content = Buffer.from(raw.data, 'base64');
    if (content.length > MAX_IMAGE_BYTES) throw new BadRequestException('inline image too large (max 5 MB)');
    total += content.length;
    if (total > MAX_TOTAL_BYTES) throw new BadRequestException('inline images too large in total (max 10 MB)');

    const type = sniff(content);
    if (!type) throw new BadRequestException('inline image is not a supported image type');
    if (String(raw.contentType).toLowerCase() !== type) throw new BadRequestException('inline image type does not match its content');
    // The editor only references images by cid:, so anything else is not attached.
    if (!html.includes(`cid:${raw.contentId}`)) continue;

    out.push({ cid: raw.contentId, filename: safeFilename(raw.filename, 'image'), contentType: type, content, contentDisposition: 'inline' });
  }
  return out;
}

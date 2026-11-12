import { BadRequestException } from '@nestjs/common';

/**
 * Opaque message id (FOX-027): folder + UIDVALIDITY + UID, never a sequence number.
 * Format: m1.<base64url(folder)>.<uidvalidity>.<uid>
 * The id only ever resolves inside the authenticated mailbox (server and credentials
 * come from the session), so it cannot reach another user's messages.
 */
export interface MessageRef {
  folder: string;
  uidValidity: bigint;
  uid: number;
}

export function encodeMessageId(folder: string, uidValidity: bigint | number | string, uid: number): string {
  return `m1.${Buffer.from(folder, 'utf8').toString('base64url')}.${BigInt(uidValidity)}.${uid}`;
}

export function assertFolder(name: unknown): string {
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
  if (typeof name !== 'string' || !name || name.length > 255 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new BadRequestException('invalid folder');
  }
  return name;
}

export function decodeMessageId(id: unknown): MessageRef {
  const m = typeof id === 'string' ? /^m1\.([A-Za-z0-9_-]{1,400})\.(\d{1,20})\.(\d{1,10})$/.exec(id) : null;
  if (!m) throw new BadRequestException('invalid message id');
  const folder = assertFolder(Buffer.from(m[1], 'base64url').toString('utf8'));
  const uid = Number(m[3]);
  const uidValidity = BigInt(m[2]);
  if (!Number.isSafeInteger(uid) || uid < 1 || uid > 0xffffffff || uidValidity < 1n || uidValidity > 0xffffffffn) {
    throw new BadRequestException('invalid message id');
  }
  return { folder, uidValidity, uid };
}

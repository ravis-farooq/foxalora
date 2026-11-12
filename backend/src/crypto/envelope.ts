import { randomBytes } from 'node:crypto';
import { Keyring, open, seal } from './keyring';

/**
 * Envelope encryption for sensitive configuration (FOX-012).
 * Each value gets its own random data key (DEK); the DEK is wrapped by a master key
 * from FOXALORA_MASTER_KEYS, which lives outside the repository, image and database.
 * `context` (for example "panel_credentials.api_token:<row id>") is authenticated, so
 * a ciphertext copied to another row or column does not decrypt.
 *
 * Token: fxe1.<master key id>.<wrapped DEK, base64url>.<payload, base64url>
 */
const PREFIX = 'fxe1';

export function envelopeEncrypt(ring: Keyring, plaintext: string, context: string): string {
  const master = ring.active;
  const dek = randomBytes(32);
  try {
    const wrapped = seal(master.key, dek, Buffer.from(`${master.id}|${context}`));
    const payload = seal(dek, Buffer.from(plaintext, 'utf8'), Buffer.from(context));
    return [PREFIX, master.id, wrapped.toString('base64url'), payload.toString('base64url')].join('.');
  } finally {
    dek.fill(0);
  }
}

function parse(token: string) {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('not an envelope token');
  return { keyId: parts[1], wrapped: Buffer.from(parts[2], 'base64url'), payload: Buffer.from(parts[3], 'base64url') };
}

function unwrapDek(ring: Keyring, keyId: string, wrapped: Buffer, context: string): Buffer {
  const master = ring.get(keyId);
  if (!master) throw new Error(`master key "${keyId}" is not configured`);
  return open(master.key, wrapped, Buffer.from(`${keyId}|${context}`));
}

export function envelopeDecrypt(ring: Keyring, token: string, context: string): string {
  const { keyId, wrapped, payload } = parse(token);
  const dek = unwrapDek(ring, keyId, wrapped, context);
  try {
    return open(dek, payload, Buffer.from(context)).toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** True when the value is wrapped by a key other than the active one. */
export function needsRewrap(ring: Keyring, token: string): boolean {
  return parse(token).keyId !== ring.active.id;
}

/** Re-wraps the data key with the active master key; the payload is not touched. */
export function envelopeRewrap(ring: Keyring, token: string, context: string): string {
  const { keyId, wrapped, payload } = parse(token);
  const dek = unwrapDek(ring, keyId, wrapped, context);
  try {
    const master = ring.active;
    const rewrapped = seal(master.key, dek, Buffer.from(`${master.id}|${context}`));
    return [PREFIX, master.id, rewrapped.toString('base64url'), payload.toString('base64url')].join('.');
  } finally {
    dek.fill(0);
  }
}

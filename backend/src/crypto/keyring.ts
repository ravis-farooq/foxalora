import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface KeyEntry {
  id: string;
  key: Buffer;
}

/**
 * Ordered set of 256-bit keys. The first key encrypts; every key decrypts, so a
 * new key can be added in front during rotation while old data stays readable.
 * Format (environment variable): "id1:base64key,id2:base64key".
 * A bare base64 key is accepted for backward compatibility and gets the id "k1".
 */
export class Keyring {
  private readonly byId: Map<string, KeyEntry>;

  constructor(readonly keys: KeyEntry[]) {
    if (!keys.length) throw new Error('keyring needs at least one key');
    this.byId = new Map();
    for (const k of keys) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(k.id)) throw new Error(`invalid key id "${k.id}"`);
      if (k.key.length !== 32) throw new Error(`key "${k.id}" must be 32 bytes`);
      if (this.byId.has(k.id)) throw new Error(`duplicate key id "${k.id}"`);
      this.byId.set(k.id, k);
    }
  }

  static parse(value: string | undefined, envName: string): Keyring {
    if (!value) throw new Error(`${envName} is required`);
    const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
    const keys = parts.map((p, i) => {
      const idx = p.indexOf(':');
      const [id, b64] = idx === -1 && parts.length === 1 ? ['k1', p] : [p.slice(0, idx), p.slice(idx + 1)];
      if (!id || !b64) throw new Error(`${envName}: entry ${i + 1} must be "id:base64key"`);
      return { id, key: Buffer.from(b64, 'base64') };
    });
    return new Keyring(keys);
  }

  get active(): KeyEntry {
    return this.keys[0];
  }

  get(id: string): KeyEntry | undefined {
    return this.byId.get(id);
  }
}

/** AES-256-GCM. Output: iv(12) | tag(16) | ciphertext. aad binds the ciphertext to its context. */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}

export function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < 28) throw new Error('ciphertext too short');
  const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAAD(aad);
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

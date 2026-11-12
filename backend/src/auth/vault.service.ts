import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { VALKEY } from '../common/tokens';
import { Keyring, open, seal } from '../crypto/keyring';

export interface SessionData {
  email: string;
  password: string;
  tenantId: string;
  serverId: string;
}

interface StoredSession {
  v: 1;
  kid: string;
  tenantId: string;
  createdAt: number;
  /** AES-256-GCM sealed JSON of SessionData, AAD = hashed session id. */
  data: string;
}

const SID = /^[A-Za-z0-9_-]{43}$/;
const key = (h: string) => `fx:s:${h}`;
const tenantIndex = (tenantId: string) => `fx:t:${tenantId}:sessions`;

/**
 * Encrypted session vault in Valkey/Redis (FOX-016, FOX-017, FOX-018).
 * - The mailbox password exists only here, sealed with the vault keyring.
 * - Keys use a SHA-256 hash of the session id, so a Valkey dump cannot be replayed
 *   as cookies; sessions are indexed per tenant for "end all sessions".
 * - Idle expiry slides on every use; absolute expiry is enforced from createdAt.
 * - Entries sealed with an older key are re-sealed with the active key when read.
 */
@Injectable()
export class VaultService {
  private readonly ring = Keyring.parse(process.env.FOXALORA_VAULT_KEYS ?? process.env.SESSION_KEY, 'FOXALORA_VAULT_KEYS');
  readonly idleMs = Number(process.env.SESSION_IDLE_MINUTES ?? 30) * 60_000;
  readonly absoluteMs = Number(process.env.SESSION_MAX_HOURS ?? 12) * 3_600_000;

  constructor(@Inject(VALKEY) private readonly redis: Redis) {}

  private hash(sid: string) {
    return createHash('sha256').update(sid).digest('hex');
  }

  private sealData(kid: string, data: SessionData, h: string): string {
    const k = this.ring.get(kid)!;
    return seal(k.key, Buffer.from(JSON.stringify(data)), Buffer.from(h)).toString('base64');
  }

  /** Stores the session and returns a new 256-bit session id (never reused, no fixation). */
  async create(data: SessionData): Promise<string> {
    const sid = randomBytes(32).toString('base64url');
    const h = this.hash(sid);
    const rec: StoredSession = { v: 1, kid: this.ring.active.id, tenantId: data.tenantId, createdAt: Date.now(), data: this.sealData(this.ring.active.id, data, h) };
    await this.redis.multi()
      .set(key(h), JSON.stringify(rec), 'PX', Math.min(this.idleMs, this.absoluteMs))
      .sadd(tenantIndex(data.tenantId), h)
      .pexpire(tenantIndex(data.tenantId), this.absoluteMs)
      .exec();
    return sid;
  }

  async get(sid: string | undefined): Promise<SessionData | null> {
    if (!sid || !SID.test(sid)) return null;
    const h = this.hash(sid);
    const raw = await this.redis.get(key(h));
    if (!raw) return null;
    let rec: StoredSession;
    try {
      rec = JSON.parse(raw);
    } catch {
      await this.redis.del(key(h));
      return null;
    }
    const age = Date.now() - rec.createdAt;
    if (age > this.absoluteMs) {
      await this.destroyHash(h, rec.tenantId);
      return null;
    }
    const k = this.ring.get(rec.kid);
    if (!k) {
      // Key removed from the ring: the session can no longer be read.
      await this.destroyHash(h, rec.tenantId);
      return null;
    }
    let data: SessionData;
    try {
      data = JSON.parse(open(k.key, Buffer.from(rec.data, 'base64'), Buffer.from(h)).toString('utf8'));
    } catch {
      await this.destroyHash(h, rec.tenantId);
      return null;
    }
    const ttl = Math.max(1, Math.min(this.idleMs, this.absoluteMs - age));
    if (rec.kid !== this.ring.active.id) {
      rec = { ...rec, kid: this.ring.active.id, data: this.sealData(this.ring.active.id, data, h) };
      await this.redis.set(key(h), JSON.stringify(rec), 'PX', ttl);
    } else {
      await this.redis.pexpire(key(h), ttl);
    }
    return data;
  }

  async destroy(sid: string | undefined): Promise<void> {
    if (!sid || !SID.test(sid)) return;
    const h = this.hash(sid);
    const raw = await this.redis.get(key(h));
    let tenantId: string | undefined;
    try {
      tenantId = raw ? (JSON.parse(raw) as StoredSession).tenantId : undefined;
    } catch {
      tenantId = undefined;
    }
    await this.destroyHash(h, tenantId);
  }

  /** Ends every session of a tenant (e.g. tenant suspended). */
  async destroyAllForTenant(tenantId: string): Promise<number> {
    const hashes = await this.redis.smembers(tenantIndex(tenantId));
    if (hashes.length) await this.redis.del(...hashes.map(key));
    await this.redis.del(tenantIndex(tenantId));
    return hashes.length;
  }

  private async destroyHash(h: string, tenantId?: string) {
    const m = this.redis.multi().del(key(h));
    if (tenantId) m.srem(tenantIndex(tenantId), h);
    await m.exec();
  }
}

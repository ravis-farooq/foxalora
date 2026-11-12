import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { VALKEY } from '../common/tokens';

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export interface ThrottleDecision {
  /** Hard block for this IP: answer 429 without trying the password. */
  blocked: boolean;
  /** Wait this long before checking the password (growing with recent failures). */
  delayMs: number;
}

/**
 * Login throttling shared across instances through Valkey (FOX-014, fixes D5).
 * There is no account lockout: failures add a growing delay, keyed mainly by
 * account+IP, so an attacker cannot lock a real user out. Only an IP that keeps
 * failing gets a hard block. Limits come from the environment for now; the admin
 * console will expose them (Phase 3).
 */
@Injectable()
export class LoginThrottleService {
  readonly windowMs = num('LOGIN_WINDOW_MINUTES', 15) * 60_000;
  readonly ipMaxFailures = num('LOGIN_IP_MAX_FAILURES', 50);
  readonly freeFailures = num('LOGIN_FREE_FAILURES', 3);
  readonly baseDelayMs = num('LOGIN_DELAY_BASE_MS', 500);
  readonly maxDelayMs = num('LOGIN_DELAY_MAX_MS', 8000);

  constructor(@Inject(VALKEY) private readonly redis: Redis) {}

  private keys(account: string, ip: string) {
    // Hashed so Valkey never holds a list of email addresses and IPs in clear.
    const h = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
    return { pair: `fx:lf:p:${h(`${account}|${ip}`)}`, ip: `fx:lf:i:${h(ip)}`, account: `fx:lf:a:${h(account)}` };
  }

  async check(account: string, ip: string): Promise<ThrottleDecision> {
    const k = this.keys(account, ip);
    const [pair, byIp, byAccount] = (await this.redis.mget(k.pair, k.ip, k.account)).map((v) => Number(v ?? 0));
    if (byIp >= this.ipMaxFailures) return { blocked: true, delayMs: 0 };
    // The account counter is shared by all IPs, so it grows slowly (one step per 5
    // failures): it slows distributed guessing without letting one attacker freeze a user.
    const level = Math.max(pair, Math.floor(byIp / 2), Math.floor(byAccount / 5)) - this.freeFailures;
    const delayMs = level < 0 ? 0 : Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** level);
    return { blocked: false, delayMs };
  }

  async recordFailure(account: string, ip: string): Promise<void> {
    const k = this.keys(account, ip);
    const m = this.redis.multi();
    for (const key of [k.pair, k.ip, k.account]) m.incr(key).pexpire(key, this.windowMs);
    await m.exec();
  }

  async recordSuccess(account: string, ip: string): Promise<void> {
    await this.redis.del(this.keys(account, ip).pair);
  }
}

import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LoginThrottleService } from '../src/auth/login-throttle.service';
import { VaultService, type SessionData } from '../src/auth/vault.service';

const URL_ = process.env.FOXALORA_TEST_VALKEY_URL ?? '';
if (!URL_ && process.env.FOXALORA_REQUIRE_INTEGRATION_TESTS) throw new Error('FOXALORA_TEST_VALKEY_URL is required in CI');

const k = () => randomBytes(32).toString('base64');
const TENANT = '11111111-2222-4333-8444-555555555555';
const DATA: SessionData = { email: 'alice@a.example', password: 'canary-P4ss-word', tenantId: TENANT, serverId: '66666666-7777-4888-8999-000000000000' };

describe.skipIf(!URL_)('session vault in Valkey', () => {
  let redis: Redis;
  const env = { ...process.env };

  beforeAll(async () => {
    redis = new Redis(URL_, { db: 15, lazyConnect: true });
    await redis.connect();
  });
  afterEach(async () => {
    process.env = { ...env };
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  const vault = (keys: string, extra: Record<string, string> = {}) => {
    Object.assign(process.env, { FOXALORA_VAULT_KEYS: keys, ...extra });
    return new VaultService(redis);
  };

  it('stores credentials encrypted under a hashed session id', async () => {
    const v = vault(`k1:${k()}`);
    const sid = await v.create(DATA);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const keys = await redis.keys('*');
    expect(keys.some((x) => x.includes(sid))).toBe(false);
    const dump = (await Promise.all(keys.filter((x) => x.startsWith('fx:s:')).map((x) => redis.get(x)))).join('');
    expect(dump).not.toContain(DATA.password);
    expect(dump).not.toContain(DATA.email);
    expect(await v.get(sid)).toEqual(DATA);
  });

  it('survives an API restart (new service instance, same keys)', async () => {
    const keys = `k1:${k()}`;
    const sid = await vault(keys).create(DATA);
    expect(await vault(keys).get(sid)).toEqual(DATA);
  });

  it('accepts two keys during rotation and re-seals old entries with the new key', async () => {
    const oldKey = `old:${k()}`;
    const sid = await vault(oldKey).create(DATA);
    const rotating = vault(`new:${k()},${oldKey}`);
    expect(await rotating.get(sid)).toEqual(DATA);
    const rec = JSON.parse((await redis.get((await redis.keys('fx:s:*'))[0]))!);
    expect(rec.kid).toBe('new');
    // After the old key is removed, the re-sealed session still works.
    expect(await vault(process.env.FOXALORA_VAULT_KEYS!.split(',')[0]).get(sid)).toEqual(DATA);
  });

  it('drops sessions whose key is no longer configured, or that were tampered with', async () => {
    const sid = await vault(`a:${k()}`).create(DATA);
    expect(await vault(`b:${k()}`).get(sid)).toBeNull();
    const keys = `c:${k()}`;
    const sid2 = await vault(keys).create(DATA);
    const name = (await redis.keys('fx:s:*'))[0];
    const rec = JSON.parse((await redis.get(name))!);
    rec.data = Buffer.from(rec.data, 'base64').fill(1, 30, 31).toString('base64');
    await redis.set(name, JSON.stringify(rec));
    expect(await vault(keys).get(sid2)).toBeNull();
  });

  it('enforces absolute expiry and idle expiry in Valkey', async () => {
    const keys = `k1:${k()}`;
    const sid = await vault(keys, { SESSION_MAX_HOURS: '0.000001' }).create(DATA); // ~3.6 ms
    await new Promise((r) => setTimeout(r, 20));
    expect(await vault(keys, { SESSION_MAX_HOURS: '0.000001' }).get(sid)).toBeNull();
    await vault(keys, { SESSION_IDLE_MINUTES: '30', SESSION_MAX_HOURS: '12' }).create(DATA);
    const ttl = await redis.pttl((await redis.keys('fx:s:*'))[0]);
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
  });

  it('destroys the entry on logout and can end all sessions of a tenant', async () => {
    const v = vault(`k1:${k()}`);
    const s1 = await v.create(DATA);
    const s2 = await v.create(DATA);
    await v.destroy(s1);
    expect(await v.get(s1)).toBeNull();
    expect(await v.get(s2)).toEqual(DATA);
    expect(await v.destroyAllForTenant(TENANT)).toBe(1);
    expect(await v.get(s2)).toBeNull();
  });

  it('ignores malformed session ids', async () => {
    const v = vault(`k1:${k()}`);
    for (const bad of [undefined, '', 'short', '../../etc', 'x'.repeat(43) + '*']) expect(await v.get(bad)).toBeNull();
  });
});

describe.skipIf(!URL_)('login throttle in Valkey (no account lockout)', () => {
  let redis: Redis;
  beforeAll(async () => {
    redis = new Redis(URL_, { db: 15, lazyConnect: true });
    await redis.connect();
  });
  afterEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('adds a growing, capped delay after free attempts, per account and IP', async () => {
    const t = new LoginThrottleService(redis);
    const delays: number[] = [];
    for (let i = 0; i < 9; i++) {
      delays.push((await t.check('alice@a.example', '198.51.100.1')).delayMs);
      await t.recordFailure('alice@a.example', '198.51.100.1');
    }
    expect(delays.slice(0, 3)).toEqual([0, 0, 0]);
    expect(delays.slice(3, 7)).toEqual([500, 1000, 2000, 4000]);
    expect(delays[8]).toBe(8000);
  });

  it('an attacker on another IP cannot meaningfully slow down or lock out the real user', async () => {
    const t = new LoginThrottleService(redis);
    for (let i = 0; i < 12; i++) await t.recordFailure('alice@a.example', '203.0.113.66');
    const victim = await t.check('alice@a.example', '198.51.100.1');
    expect(victim.blocked).toBe(false);
    expect(victim.delayMs).toBe(0); // account counter 12 -> level floor(12/5)-3 < 0
  });

  it('hard-blocks only an IP that keeps failing, and success clears the pair counter', async () => {
    process.env.LOGIN_IP_MAX_FAILURES = '6';
    const t = new LoginThrottleService(redis);
    for (let i = 0; i < 6; i++) await t.recordFailure(`user${i}@a.example`, '203.0.113.9');
    expect((await t.check('someone@a.example', '203.0.113.9')).blocked).toBe(true);
    expect((await t.check('someone@a.example', '198.51.100.2')).blocked).toBe(false);
    delete process.env.LOGIN_IP_MAX_FAILURES;

    const t2 = new LoginThrottleService(redis);
    for (let i = 0; i < 5; i++) await t2.recordFailure('bob@b.example', '198.51.100.3');
    expect((await t2.check('bob@b.example', '198.51.100.3')).delayMs).toBeGreaterThan(0);
    await t2.recordSuccess('bob@b.example', '198.51.100.3');
    expect((await t2.check('bob@b.example', '198.51.100.3')).delayMs).toBe(0);
  });
});

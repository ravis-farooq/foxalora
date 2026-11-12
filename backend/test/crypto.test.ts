import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { envelopeDecrypt, envelopeEncrypt, envelopeRewrap, needsRewrap } from '../src/crypto/envelope';
import { Keyring } from '../src/crypto/keyring';

const k = () => randomBytes(32).toString('base64');

describe('Keyring', () => {
  it('parses id:key lists and a legacy bare key', () => {
    const r = Keyring.parse(`new:${k()}, old:${k()}`, 'X');
    expect(r.active.id).toBe('new');
    expect(r.get('old')).toBeDefined();
    expect(Keyring.parse(k(), 'X').active.id).toBe('k1');
  });

  it('rejects missing, short, duplicate and badly named keys', () => {
    expect(() => Keyring.parse(undefined, 'X')).toThrow(/X is required/);
    expect(() => Keyring.parse(`a:${Buffer.alloc(16).toString('base64')}`, 'X')).toThrow(/32 bytes/);
    const key = k();
    expect(() => Keyring.parse(`a:${key},a:${key}`, 'X')).toThrow(/duplicate/);
    expect(() => Keyring.parse(`bad id:${key}`, 'X')).toThrow(/invalid key id/);
  });
});

describe('envelope encryption (FOX-012)', () => {
  const ctx = 'panel_credentials.api_token:3f2a';

  it('round-trips with a fresh data key per value', () => {
    const ring = Keyring.parse(`m1:${k()}`, 'M');
    const a = envelopeEncrypt(ring, 'secret-token', ctx);
    const b = envelopeEncrypt(ring, 'secret-token', ctx);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret-token');
    expect(envelopeDecrypt(ring, a, ctx)).toBe('secret-token');
  });

  it('fails for a different context (copied to another row) or tampered data', () => {
    const ring = Keyring.parse(`m1:${k()}`, 'M');
    const t = envelopeEncrypt(ring, 'secret', ctx);
    expect(() => envelopeDecrypt(ring, t, 'panel_credentials.api_token:other')).toThrow();
    const parts = t.split('.');
    const payload = Buffer.from(parts[3], 'base64url');
    payload[payload.length - 1] ^= 1;
    expect(() => envelopeDecrypt(ring, [parts[0], parts[1], parts[2], payload.toString('base64url')].join('.'), ctx)).toThrow();
  });

  it('supports rotation: old values readable with both keys, re-wrapped to the new key', () => {
    const oldKey = k();
    const before = Keyring.parse(`m1:${oldKey}`, 'M');
    const t1 = envelopeEncrypt(before, 'secret', ctx);

    const during = Keyring.parse(`m2:${k()},m1:${oldKey}`, 'M');
    expect(envelopeDecrypt(during, t1, ctx)).toBe('secret');
    expect(needsRewrap(during, t1)).toBe(true);
    const t2 = envelopeRewrap(during, t1, ctx);
    expect(t2.split('.')[1]).toBe('m2');
    expect(t2.split('.')[3]).toBe(t1.split('.')[3]); // payload untouched

    const after = new Keyring([during.active]);
    expect(envelopeDecrypt(after, t2, ctx)).toBe('secret');
    expect(() => envelopeDecrypt(after, t1, ctx)).toThrow(/not configured/);
  });
});

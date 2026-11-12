import { BadRequestException } from '@nestjs/common';
import { CONTROL_CHARS } from '../common/email';

/**
 * Per-mailbox preferences (FOX-077). Only settings the app actually applies are listed;
 * more are added with the features that use them (language with i18n, remote images
 * with the image opt-in, and so on).
 */
export interface Preferences {
  /** Name shown to recipients next to the address. Empty: the address alone. */
  displayName: string;
  theme: 'system' | 'light' | 'dark';
  density: 'comfortable' | 'compact';
  /** 'auto' uses the browser's time zone. */
  timeZone: string;
  /** Keep the addresses written to, for recipient suggestions. */
  rememberRecipients: boolean;
  /** The first-run guide was finished or skipped. */
  onboarded: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { displayName: '', theme: 'system', density: 'comfortable', timeZone: 'auto', rememberRecipients: true, onboarded: false };

const TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);

type Check = (v: unknown) => boolean;
const CHECKS: { [K in keyof Preferences]: Check } = {
  // No control characters (header injection) and no angle brackets or quotes, so the
  // name cannot pose as another address ("PayPal <security@paypal.com>").
  displayName: (v) => typeof v === 'string' && v.trim().length <= 100 && !CONTROL_CHARS.test(v) && !/[<>"]/.test(v),
  theme: (v) => v === 'system' || v === 'light' || v === 'dark',
  density: (v) => v === 'comfortable' || v === 'compact',
  timeZone: (v) => typeof v === 'string' && (v === 'auto' || TIME_ZONES.has(v)),
  rememberRecipients: (v) => typeof v === 'boolean',
  onboarded: (v) => typeof v === 'boolean',
};
const KEYS = Object.keys(CHECKS) as (keyof Preferences)[];

/** Validates an update: every key must be known and every value valid. */
export function parsePreferencesPatch(body: unknown): Partial<Preferences> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    throw new BadRequestException('invalid preferences');
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const check = CHECKS[key as keyof Preferences];
    if (!Object.hasOwn(CHECKS, key) || !check(value)) throw new BadRequestException(`invalid preference: ${key}`);
    out[key] = typeof value === 'string' ? value.trim() : value;
  }
  return out as Partial<Preferences>;
}

/** Stored values merged over the defaults. Values that are no longer valid fall back to the default. */
export function withDefaults(stored: Record<string, unknown> | null | undefined): Preferences {
  const out: Record<string, unknown> = { ...DEFAULT_PREFERENCES };
  for (const key of KEYS) if (stored && Object.hasOwn(stored, key) && CHECKS[key](stored[key])) out[key] = stored[key];
  return out as unknown as Preferences;
}

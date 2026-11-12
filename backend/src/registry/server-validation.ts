import { isIP } from 'node:net';
import type { TlsPolicy } from '../database/schema';

export interface ServerInput {
  name: string;
  imapHost: string;
  imapPort: number;
  imapTls: TlsPolicy;
  smtpHost: string;
  smtpPort: number;
  smtpTls: TlsPolicy;
  allowPrivate: boolean;
}

export class ServerValidationError extends Error {}

// Standard ports per protocol and TLS mode. A mismatched pair (e.g. implicit TLS on
// 143) is almost always a misconfiguration that would fail or, worse, downgrade.
const PORTS: Record<'IMAP' | 'SMTP', Record<'tls' | 'starttls', number[]>> = {
  IMAP: { tls: [993], starttls: [143] },
  SMTP: { tls: [465], starttls: [587, 25] },
};
const TLS_POLICIES: TlsPolicy[] = ['tls', 'starttls', 'none-dev-only'];
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

function host(value: unknown, label: string): string {
  const h = String(value ?? '').trim().toLowerCase();
  if (!h || (!isIP(h) && !HOSTNAME.test(h))) throw new ServerValidationError(`${label} host is invalid`);
  return h;
}

function endpoint(proto: 'IMAP' | 'SMTP', port: unknown, tls: unknown, production: boolean): [number, TlsPolicy] {
  if (!TLS_POLICIES.includes(tls as TlsPolicy)) throw new ServerValidationError(`${proto} TLS policy is invalid`);
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new ServerValidationError(`${proto} port is invalid`);
  if (tls === 'none-dev-only') {
    if (production) throw new ServerValidationError(`${proto}: unencrypted connections are refused in production`);
    return [p, tls];
  }
  if (!PORTS[proto][tls as 'tls' | 'starttls'].includes(p)) {
    throw new ServerValidationError(`${proto} port ${p} is not a standard port for ${tls} (${PORTS[proto][tls as 'tls' | 'starttls'].join(', ')})`);
  }
  return [p, tls as TlsPolicy];
}

/** Validates and normalises an administrator-supplied mail server (FOX-006). */
export function validateServerInput(input: ServerInput, opts: { production: boolean }): ServerInput {
  const name = String(input?.name ?? '').trim();
  if (!name || name.length > 100) throw new ServerValidationError('server name is required (max 100 characters)');
  const [imapPort, imapTls] = endpoint('IMAP', input.imapPort, input.imapTls, opts.production);
  const [smtpPort, smtpTls] = endpoint('SMTP', input.smtpPort, input.smtpTls, opts.production);
  return {
    name,
    imapHost: host(input.imapHost, 'IMAP'),
    imapPort,
    imapTls,
    smtpHost: host(input.smtpHost, 'SMTP'),
    smtpPort,
    smtpTls,
    allowPrivate: input.allowPrivate === true,
  };
}

export const isProduction = () => process.env.NODE_ENV === 'production';

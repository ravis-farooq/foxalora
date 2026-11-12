import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import type { MailServer } from '../registry/registry.service';
import { resolveSafeAddresses } from '../security/ssrf';

export interface MailboxCreds {
  email: string;
  password: string;
  server: MailServer;
}

type SmtpTransport = ReturnType<typeof nodemailer.createTransport>;

// Failures that happen before anything is exchanged with the server, so trying the
// next validated address is safe (never retried: auth errors, or SMTP errors once a
// send could have started, which might deliver a message twice).
const CONNECT_ERRORS = new Set(['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL', 'ECONNRESET']);

function isConnectFailure(e: any, smtp: boolean): boolean {
  if (CONNECT_ERRORS.has(e?.code)) return smtp ? e?.command === 'CONN' || !e?.command : true;
  if (smtp) return e?.code === 'ETIMEDOUT' && e?.command === 'CONN';
  return e?.code === 'ETIMEDOUT' || e?.code === 'CONNECT_TIMEOUT';
}

async function tryAddresses<T>(ips: string[], smtp: boolean, attempt: (ip: string) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const ip of ips) {
    try {
      return await attempt(ip);
    } catch (e) {
      last = e;
      if (!isConnectFailure(e, smtp)) throw e;
    }
  }
  throw last;
}

/** Defence in depth: the registry refuses this in production, and so does the adapter. */
function assertTlsAllowed(server: MailServer) {
  if (process.env.NODE_ENV === 'production' && (server.imapTls === 'none-dev-only' || server.smtpTls === 'none-dev-only')) {
    throw new Error('unencrypted mail connections are refused in production');
  }
}

/**
 * IMAP connection factory.
 * Host is ALWAYS from the admin mapping, resolved + validated (SSRF), and we
 * connect to a pinned IP while TLS still verifies the real hostname.
 * No silent fallback to plaintext: 'tls' => implicit TLS, 'starttls' => STARTTLS
 * is forced (connection fails if the server does not offer it).
 */
export async function openImap(c: MailboxCreds): Promise<ImapFlow> {
  const { server } = c;
  assertTlsAllowed(server);
  const ips = await resolveSafeAddresses(server.imapHost, server.allowPrivate);

  return tryAddresses(ips, false, async (ip) => {
    const client = new ImapFlow({
      host: ip,
      port: server.imapPort,
      // Certificate is verified against the configured hostname, not the pinned IP.
      servername: server.imapHost,
      secure: server.imapTls === 'tls',
      doSTARTTLS: server.imapTls === 'starttls' ? true : server.imapTls === 'none-dev-only' ? false : undefined,
      auth: { user: c.email, pass: c.password },
      tls: {
        servername: server.imapHost,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
      },
      logger: false, // never log protocol traffic: it contains credentials/content
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    await client.connect();
    return client;
  });
}

/** Runs fn with an SMTP transport pinned to a validated address, then closes it. */
export async function withSmtp<T>(c: MailboxCreds, fn: (t: SmtpTransport) => Promise<T>): Promise<T> {
  const { server } = c;
  assertTlsAllowed(server);
  const ips = await resolveSafeAddresses(server.smtpHost, server.allowPrivate);

  return tryAddresses(ips, true, async (ip) => {
    const t = nodemailer.createTransport({
      host: ip,
      port: server.smtpPort,
      secure: server.smtpTls === 'tls',
      requireTLS: server.smtpTls === 'starttls',
      ignoreTLS: server.smtpTls === 'none-dev-only',
      tls: { servername: server.smtpHost, minVersion: 'TLSv1.2', rejectUnauthorized: true },
      auth: { user: c.email, pass: c.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    try {
      return await fn(t);
    } finally {
      t.close();
    }
  });
}

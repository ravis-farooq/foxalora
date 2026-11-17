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

/** Connection settings of a server, without its registry identity (the setup wizard tests unsaved ones). */
export type ServerEndpoints = Pick<MailServer, 'imapHost' | 'imapPort' | 'imapTls' | 'smtpHost' | 'smtpPort' | 'smtpTls' | 'allowPrivate'>;
interface Auth { user: string; pass: string }

/** Defence in depth: the registry refuses this in production, and so does the adapter. */
function assertTlsAllowed(server: ServerEndpoints) {
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
 * Without auth the connection stays unauthenticated (connection test only).
 */
async function connectImap(server: ServerEndpoints, auth: Auth | undefined): Promise<ImapFlow> {
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
      ...(auth ? { auth } : {}),
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

export function openImap(c: MailboxCreds): Promise<ImapFlow> {
  return connectImap(c.server, { user: c.email, pass: c.password });
}

function smtpTransport(server: ServerEndpoints, ip: string, auth: Auth | undefined): SmtpTransport {
  return nodemailer.createTransport({
    host: ip,
    port: server.smtpPort,
    secure: server.smtpTls === 'tls',
    requireTLS: server.smtpTls === 'starttls',
    ignoreTLS: server.smtpTls === 'none-dev-only',
    tls: { servername: server.smtpHost, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    ...(auth ? { auth } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

/** Runs fn with an SMTP transport pinned to a validated address, then closes it. */
export async function withSmtp<T>(c: MailboxCreds, fn: (t: SmtpTransport) => Promise<T>): Promise<T> {
  const { server } = c;
  assertTlsAllowed(server);
  const ips = await resolveSafeAddresses(server.smtpHost, server.allowPrivate);

  return tryAddresses(ips, true, async (ip) => {
    const t = smtpTransport(server, ip, { user: c.email, pass: c.password });
    try {
      return await fn(t);
    } finally {
      t.close();
    }
  });
}

export interface ProbeResult {
  ok: boolean;
  /** Safe reason token on failure (error code, TLS code, auth class); never server text. */
  reason?: string;
}

/**
 * Setup wizard and admin console: can Foxalora reach this server over TLS, and, with a
 * test mailbox, log in? Same SSRF guard, TLS policy and address pinning as real logins.
 * The test password is used for this one attempt and never stored or logged.
 */
export async function probeServer(server: ServerEndpoints, auth: Auth | undefined, reasonOf: (e: unknown) => string) {
  const imap = async (): Promise<ProbeResult> => {
    try {
      const client = await connectImap(server, auth);
      await client.logout().catch(() => undefined);
      return { ok: true };
    } catch (e) {
      // Without a test mailbox imapflow stops at its own "no login configured" check, which
      // runs after the greeting and TLS or STARTTLS: the connection itself is fine.
      if (!auth && (e as { authenticationFailed?: unknown })?.authenticationFailed === true) return { ok: true };
      return { ok: false, reason: reasonOf(e) };
    }
  };
  const smtp = async (): Promise<ProbeResult> => {
    try {
      assertTlsAllowed(server);
      const ips = await resolveSafeAddresses(server.smtpHost, server.allowPrivate);
      await tryAddresses(ips, true, async (ip) => {
        const t = smtpTransport(server, ip, auth);
        try {
          await t.verify(); // EHLO, STARTTLS or TLS, and AUTH when a test mailbox is given; sends nothing
        } finally {
          t.close();
        }
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: reasonOf(e) };
    }
  };
  const [i, s] = await Promise.all([imap(), smtp()]);
  return { imap: i, smtp: s };
}

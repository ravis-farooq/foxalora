/** First-run setup wizard API (/api/v1/setup). Every call carries the install's one-time setup token. */
export type CheckStatus = 'ok' | 'warn' | 'fail';
export interface SetupCheck { id: string; label: string; status: CheckStatus; detail: string }
export interface ServerSettings {
  imapHost: string; imapPort: number; imapTls: 'tls' | 'starttls';
  smtpHost: string; smtpPort: number; smtpTls: 'tls' | 'starttls';
  allowPrivate: boolean; savesSent: boolean;
}
export interface ProbeResult { ok: boolean; reason?: string }
export interface TestResult { imap: ProbeResult; smtp: ProbeResult; loginTested: boolean }

export class SetupError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1/setup${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Requested-With': 'foxalora',
      'X-Setup-Token': token,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json())?.error?.message ?? msg; } catch { /* not JSON */ }
    throw new SetupError(res.status, msg);
  }
  return res.json();
}

export const setupApi = {
  checks: (token: string) => call<{ site: string; checks: SetupCheck[] }>(token, 'GET', '/checks'),
  testServer: (token: string, server: ServerSettings, mailbox?: { email: string; password: string }) =>
    call<TestResult>(token, 'POST', '/test-server', { server, mailbox }),
  complete: (token: string, input: { organisation: string; admin: { email: string; password: string }; server: ServerSettings; domains: string[] }) =>
    call<{ done: true }>(token, 'POST', '/complete', input),
};

/** Plain-language explanation of a connection test failure token. */
export function explainReason(reason = ''): string {
  const rules: [RegExp, string][] = [
    [/^SSRF_BLOCKED$/, 'This host name points to a private or reserved address. If your mail server really is on your private network, turn on "Mail server is on a private network" under Advanced.'],
    [/^(ENOTFOUND|EAI_AGAIN|ENODATA|EDNS)$/, 'Host name not found. Check the spelling and the DNS record.'],
    [/^ECONNREFUSED$/, 'Connection refused on this port. Check that the service runs and the port is open.'],
    [/^(ETIMEDOUT|CONNECT_TIMEOUT|EHOSTUNREACH|ENETUNREACH|ESOCKET|ECONNRESET)$/, 'No answer from the server. A firewall may be blocking this port, or the security setting does not match the port.'],
    [/^CERT_HAS_EXPIRED$/, "The server's TLS certificate has expired."],
    [/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/, "The server's TLS certificate is not trusted (self-signed or missing its intermediate certificate). Use a certificate from a public authority such as Let's Encrypt."],
    [/ALTNAME|HOSTNAME/, 'The TLS certificate is for a different host name. Enter the name that is on the certificate.'],
    [/^ETLS$/, 'The server does not offer STARTTLS on this port. Try SSL/TLS instead.'],
    [/^(EPROTO|ERR_SSL)/, 'The TLS handshake failed. Check that the security setting matches the port.'],
    [/^imap_auth|^smtp_auth|^EAUTH$/, 'The server was reached, but the test mailbox could not sign in. Check its address and password.'],
  ];
  const hit = rules.find(([re]) => re.test(reason));
  return hit ? hit[1] : `Could not connect (${reason || 'unknown error'}).`;
}

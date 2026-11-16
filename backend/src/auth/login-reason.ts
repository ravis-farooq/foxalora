/**
 * Short, safe reason class for a failed mailbox login, for the auth log and audit trail.
 * Only fixed tokens are kept (IMAP response codes such as AUTHENTICATIONFAILED, SMTP status
 * numbers, network error codes). Server response text, error messages and anything that could
 * carry a password are never included (CLAUDE.md rule 8).
 */
const TOKEN = /^[A-Z][A-Z0-9_-]{1,31}$/;

export function loginFailureReason(e: unknown): string {
  if (!e || typeof e !== 'object') return 'error';
  const err = e as { authenticationFailed?: unknown; serverResponseCode?: unknown; code?: unknown; responseCode?: unknown };
  if (err.authenticationFailed === true) {
    const code = typeof err.serverResponseCode === 'string' && TOKEN.test(err.serverResponseCode) ? err.serverResponseCode : 'other';
    return `imap_auth:${code}`;
  }
  if (err.code === 'EAUTH') {
    const status = Number.isInteger(err.responseCode) ? String(err.responseCode) : 'other';
    return `smtp_auth:${status}`;
  }
  if (typeof err.code === 'string' && TOKEN.test(err.code)) return err.code;
  return 'error';
}

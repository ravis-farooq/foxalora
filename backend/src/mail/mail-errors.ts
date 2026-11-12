import { HttpException } from '@nestjs/common';
import { SsrfError } from '../security/ssrf';

/** An error with a stable code the UI can act on (FOX-028). Message is always generic. */
export class MailError extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
  ) {
    super(message, status);
  }
}

const TLS_CODE = /^(ERR_TLS|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_SSL)/;

/**
 * Maps imapflow / nodemailer / network errors to stable codes. Raw server responses
 * are never copied into the result: they can contain addresses or mailbox names.
 */
export function normalizeMailError(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  const err = (e ?? {}) as {
    code?: string; authenticationFailed?: boolean; mailboxMissing?: boolean; responseStatus?: string;
    responseCode?: number; serverResponseCode?: string; command?: string;
  };
  const code = err.code ?? '';

  if (e instanceof SsrfError) return new MailError('mail_server_unavailable', 502, 'The mail server could not be reached.');
  if (err.mailboxMissing) return new MailError('folder_not_found', 404, 'Folder not found.');
  if (err.authenticationFailed || code === 'EAUTH' || err.serverResponseCode === 'AUTHENTICATIONFAILED') {
    return new MailError('mail_auth_failed', 401, 'The mail server no longer accepts this login. Sign in again.');
  }
  if (TLS_CODE.test(code)) return new MailError('mail_server_tls_error', 502, 'Secure connection to the mail server failed.');
  if (['ETIMEDOUT', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'ESOCKETTIMEDOUT'].includes(code)) {
    return new MailError('mail_server_timeout', 504, 'The mail server did not respond in time.');
  }
  if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EPIPE', 'NoConnection'].includes(code)) {
    return new MailError('mail_server_unavailable', 502, 'The mail server could not be reached.');
  }
  if (code === 'EENVELOPE') return new MailError('recipient_rejected', 400, 'The mail server rejected one or more recipients.');
  if (code === 'EMESSAGE') return new MailError('message_rejected', 400, 'The mail server rejected the message.');
  if (err.responseStatus === 'NO' || err.responseStatus === 'BAD') {
    return new MailError('mail_protocol_error', 502, 'The mail server refused the request.');
  }
  return new MailError('mail_error', 502, 'Something went wrong talking to the mail server.');
}

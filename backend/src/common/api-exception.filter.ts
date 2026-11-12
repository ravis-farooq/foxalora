import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { SsrfError } from '../security/ssrf';

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  413: 'payload_too_large',
  429: 'rate_limited',
};

/**
 * One error shape for the whole API: { error: { code, message, requestId } }.
 * Mail-library errors carry IMAP/SMTP responses and the commands that were sent,
 * so they are never logged or returned; only their class and our code are logged.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private log = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const requestId = randomUUID();

    let status = 500;
    let code = 'internal_error';
    let message = 'Something went wrong. Try again.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const own = (exception as { code?: unknown }).code; // MailError carries a stable code (FOX-028)
      code = typeof own === 'string' ? own : CODES[status] ?? (status >= 500 ? 'internal_error' : 'error');
      const body = exception.getResponse();
      const m = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      if (typeof m === 'string') message = m;
      else if (Array.isArray(m)) message = m.join(', ');
    } else if ((exception as { mailboxMissing?: boolean })?.mailboxMissing) {
      status = 404;
      code = 'folder_not_found';
      message = 'Folder not found.';
    } else if (exception instanceof SsrfError) {
      status = 502;
      code = 'mail_server_unavailable';
      message = 'The mail server could not be reached.';
    }

    if (status >= 500 || code === 'folder_not_found') {
      const kind = exception instanceof Error ? exception.constructor.name : typeof exception;
      // Path without the query string: queries contain folder names.
      this.log.warn(`${req.method} ${req.path} -> ${status} ${code} (${kind}) requestId=${requestId}`);
    }

    res.status(status).json({ error: { code, message, requestId } });
  }
}

import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json, type NextFunction, type Request, type Response } from 'express';
import { ApiExceptionFilter } from './common/api-exception.filter';

const deny = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ error: { code, message } });

/** HTTP pipeline shared by the server and the end-to-end tests. */
export function configureApp(app: INestApplication) {
  const http = app.getHttpAdapter().getInstance();

  // D6 / FOX-143: X-Forwarded-For is trusted only from these proxies. The default
  // (loopback + private networks) fits Nginx in the Docker stack; a client on the
  // internet cannot spoof its IP to dodge login throttling.
  http.set('trust proxy', (process.env.TRUST_PROXY ?? 'loopback,uniquelocal').split(',').map((s) => s.trim()));
  http.disable('x-powered-by');

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());

  // FOX-143: reject requests for other host names (Host-header poisoning).
  const allowedHosts = (process.env.ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowedHosts.length) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const host = (req.hostname ?? '').toLowerCase();
      return allowedHosts.includes(host) ? next() : deny(res, 400, 'bad_host', 'Unknown host.');
    });
  }

  // FOX-142: browsers label cross-site requests; the API only serves its own pages.
  // Requests without the header (old browsers, curl) still face SameSite + CSRF header.
  app.use((req: Request, res: Response, next: NextFunction) =>
    req.headers['sec-fetch-site'] === 'cross-site' ? deny(res, 403, 'cross_site', 'Cross-site request refused.') : next());

  // Request size limits: sending may carry inline images (validated: 10 MB of images max);
  // everything else stays small.
  app.use('/api/v1/messages/send', json({ limit: '15mb' }));
  app.use('/api/v1/drafts', json({ limit: '15mb' })); // drafts carry the same inline images
  app.use('/api/v1/contacts/import', json({ limit: '3mb' })); // vCard files up to 2 MB
  app.use(json({ limit: '1mb' }));
  app.use(cookieParser());

  // Baseline security headers for API responses (PRD 5.6).
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    }
    next();
  });
  app.enableShutdownHooks();
}

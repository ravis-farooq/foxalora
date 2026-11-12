import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { RegistryService } from '../registry/registry.service';
import { AuthedRequest, AuthGuard, COOKIE_NAME, hasCsrfHeader } from './auth.guard';
import { LoginThrottleService } from './login-throttle.service';
import { VaultService } from './vault.service';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
// AUTH-012: ONE generic message for every failure reason (unknown domain, bad
// password, server down, blocked destination) so nothing can be enumerated.
const GENERIC_FAIL = 'Login failed. Check your email address and password.';
// FOX-008: failures never answer faster than this (+ jitter), so an unmapped domain
// is not distinguishable from a wrong password by timing.
const MIN_FAILURE_MS = Number(process.env.LOGIN_MIN_FAILURE_MS ?? 1200);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Controller('auth')
export class AuthController {
  private log = new Logger('Auth');

  constructor(
    private vault: VaultService,
    private registry: RegistryService,
    private mail: MailService,
    private throttle: LoginThrottleService,
    private audit: AuditService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: { email?: unknown; password?: unknown }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const started = Date.now();
    const fail = async (status: 400 | 401 = 401): Promise<never> => {
      await sleep(Math.max(0, MIN_FAILURE_MS - (Date.now() - started)) + randomInt(0, 300));
      throw status === 400 ? new BadRequestException(GENERIC_FAIL) : new UnauthorizedException(GENERIC_FAIL);
    };

    if (!hasCsrfHeader(req)) return fail();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email) || email.length > 320 || !password || password.length > 1024) return fail(400);

    const ip = req.ip ?? 'unknown';
    const decision = await this.throttle.check(email, ip);
    if (decision.blocked) {
      this.log.warn('login throttled: IP over failure limit');
      throw new HttpException('Too many attempts. Try again later.', 429);
    }
    if (decision.delayMs) await sleep(decision.delayMs);

    const server = await this.registry.resolveEmail(email);
    if (!server) {
      this.log.warn('login rejected: domain not mapped to an active tenant');
      await this.throttle.recordFailure(email, ip);
      return fail();
    }

    try {
      await this.mail.verifyLogin({ email, password, server });
    } catch (e: unknown) {
      // Log reason class only. Never log the password or raw error objects from
      // the mail libraries (they may echo server responses).
      const reason = (e as { code?: string; name?: string })?.code ?? (e as Error)?.name ?? 'error';
      this.log.warn(`login failed (${reason})`);
      await this.throttle.recordFailure(email, ip);
      await this.audit.record(server.tenantId, 'auth.login_failed', email, { ip, reason, delayedMs: decision.delayMs });
      return fail();
    }

    await this.throttle.recordSuccess(email, ip);
    // D13: a login always replaces whatever session the browser had.
    await this.vault.destroy(req.cookies?.[COOKIE_NAME]);
    const sid = await this.vault.create({ email, password, tenantId: server.tenantId, serverId: server.id });
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: this.vault.absoluteMs,
    });
    await this.audit.record(server.tenantId, 'auth.login', email, { ip });
    return { email };
  }

  /** Works with an expired session too, so the cookie is always cleared (D13). */
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!hasCsrfHeader(req)) throw new UnauthorizedException();
    const sid = req.cookies?.[COOKIE_NAME];
    const session = await this.vault.get(sid);
    await this.vault.destroy(sid);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    if (session) await this.audit.record(session.tenantId, 'auth.logout', session.email, { ip: req.ip ?? 'unknown' });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthedRequest) {
    return { email: req.mailbox.email }; // never returns the password
  }
}

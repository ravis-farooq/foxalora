import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { MailServer, RegistryService } from '../registry/registry.service';
import { VaultService } from './vault.service';

export const COOKIE_NAME = 'fx_sid';
export const CSRF_HEADER = 'x-requested-with';

export function hasCsrfHeader(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  return req.headers[CSRF_HEADER] === 'foxalora';
}

export interface AuthedRequest extends Request {
  mailbox: { email: string; password: string; tenantId: string; server: MailServer };
}

/**
 * Authentication + CSRF guard.
 * CSRF: cookie is SameSite=Strict AND every state-changing request must carry a
 * custom header that a cross-site form/img cannot set (double protection).
 * Tenant and server come only from the session (CLAUDE.md rule 7).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private vault: VaultService,
    private registry: RegistryService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !hasCsrfHeader(req)) {
      throw new ForbiddenException('CSRF check failed');
    }

    const s = await this.vault.get(req.cookies?.[COOKIE_NAME]);
    if (!s) throw new UnauthorizedException();
    const server = await this.registry.getServer(s.tenantId, s.serverId);
    if (!server) throw new UnauthorizedException(); // server removed by the admin

    req.mailbox = { email: s.email, password: s.password, tenantId: s.tenantId, server };
    return true;
  }
}

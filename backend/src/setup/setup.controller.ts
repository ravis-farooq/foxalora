import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { hasCsrfHeader } from '../auth/auth.guard';
import { ServerValidationError } from '../registry/server-validation';
import { parseServer, parseSetupInput, parseTestMailbox } from './setup-input';
import { SetupClosedError, SetupConflictError, SetupService } from './setup.service';

export const SETUP_TOKEN_HEADER = 'x-setup-token';

/**
 * /api/v1/setup: the first-run wizard. Every route is 404 unless setup is open AND the
 * request carries the install's setup token, so a finished install, or a visitor without
 * the link, cannot tell that the wizard exists.
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  private async gate(req: Request) {
    if (req.method !== 'GET' && !hasCsrfHeader(req)) throw new NotFoundException();
    if (!this.setup.tokenMatches(req.headers[SETUP_TOKEN_HEADER])) throw new NotFoundException();
    if (!(await this.setup.isOpen())) throw new NotFoundException();
  }

  private static badInput(e: unknown): never {
    if (e instanceof ServerValidationError) throw new BadRequestException(e.message);
    throw e;
  }

  @Get('checks')
  async checks(@Req() req: Request) {
    await this.gate(req);
    return { site: req.hostname, checks: await this.setup.checks(req) };
  }

  @Post('test-server')
  @HttpCode(200)
  async testServer(@Req() req: Request, @Body() body: { server?: unknown; mailbox?: unknown }) {
    await this.gate(req);
    let server, mailbox;
    try {
      server = parseServer(body?.server);
      mailbox = parseTestMailbox(body?.mailbox);
    } catch (e) {
      SetupController.badInput(e);
    }
    return this.setup.testServer(server, mailbox);
  }

  @Post('complete')
  @HttpCode(200)
  async complete(@Req() req: Request, @Body() body: unknown) {
    await this.gate(req);
    let input;
    try {
      input = parseSetupInput(body);
    } catch (e) {
      SetupController.badInput(e);
    }
    try {
      await this.setup.complete(input, req.ip ?? 'unknown');
    } catch (e) {
      if (e instanceof SetupClosedError) throw new NotFoundException();
      if (e instanceof SetupConflictError) throw new ConflictException(e.message);
      SetupController.badInput(e);
    }
    return { done: true };
  }
}

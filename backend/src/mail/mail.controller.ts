import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { MailService } from './mail.service';

/**
 * Every route uses the mailbox from the SESSION, never from request params, so a
 * message id can only ever resolve inside the authenticated user's own mailbox.
 * Message ids are opaque (folder + UIDVALIDITY + UID, see message-id.ts).
 */
@Controller()
@UseGuards(AuthGuard)
export class MailController {
  constructor(private mail: MailService) {}

  @Get('mailboxes')
  folders(@Req() req: AuthedRequest) {
    return this.mail.listFolders(req.mailbox);
  }

  @Get('messages')
  list(@Req() req: AuthedRequest, @Query('folder') folder = 'INBOX', @Query('page') page = '1', @Query('pageSize') pageSize = '25') {
    return this.mail.listMessages(req.mailbox, folder, Number(page), Number(pageSize));
  }

  @Get('messages/:id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.mail.getMessage(req.mailbox, id);
  }

  @Get('messages/:id/attachments/:part')
  async attachment(@Req() req: AuthedRequest, @Param('id') id: string, @Param('part') part: string, @Res() res: Response) {
    await this.mail.streamAttachment(req.mailbox, id, part, (filename) => {
      // Always force download + generic type: never let the browser render/execute it.
      const ascii = filename.replace(/[^\w.\- ]+/g, '_');
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      return res;
    });
  }

  @Patch('messages/:id')
  @HttpCode(204)
  async flags(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { seen?: unknown; flagged?: unknown } = {}) {
    await this.mail.setFlags(req.mailbox, id, {
      seen: typeof body?.seen === 'boolean' ? body.seen : undefined,
      flagged: typeof body?.flagged === 'boolean' ? body.flagged : undefined,
    });
  }

  @Delete('messages/:id')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.mail.deleteMessage(req.mailbox, id);
  }

  @Post('messages/send')
  @HttpCode(202)
  async send(@Req() req: AuthedRequest, @Body() body: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text?: string; html?: string }) {
    await this.mail.send(req.mailbox, body);
    return { status: 'sent' };
  }
}

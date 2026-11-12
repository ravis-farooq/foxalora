import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import { ContactsService, type Owner } from './contacts.service';
import { RecipientsService } from './recipients.service';

const owner = (req: AuthedRequest): Owner => ({ tenantId: req.mailbox.tenantId, email: req.mailbox.email });

/** Address book of the signed-in mailbox. Tenant and mailbox come from the session only. */
@Controller('contacts')
@UseGuards(AuthGuard)
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly recipients: RecipientsService,
  ) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query('q') q?: unknown, @Query('page') page?: unknown) {
    return this.contacts.list(owner(req), q, page);
  }

  // Fixed paths are declared before ':id'.
  @Get('suggest')
  suggest(@Req() req: AuthedRequest, @Query('q') q?: unknown) {
    return this.contacts.suggest(owner(req), q);
  }

  @Get('export')
  async export(@Req() req: AuthedRequest, @Res() res: Response, @Query('ids') ids?: unknown) {
    const vcf = await this.contacts.exportVCard(owner(req), ids);
    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(vcf);
  }

  /** Forgets the addresses written to (Settings > Clear history). */
  @Delete('recent')
  @HttpCode(204)
  async clearRecent(@Req() req: AuthedRequest) {
    await this.recipients.clear(owner(req));
  }

  @Post('import')
  @HttpCode(200)
  import(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.contacts.importVCard(owner(req), body);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.contacts.create(owner(req), body);
  }

  @Get(':id')
  get(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.contacts.get(owner(req), id);
  }

  @Put(':id')
  update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.contacts.update(owner(req), id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.contacts.remove(owner(req), id);
  }
}

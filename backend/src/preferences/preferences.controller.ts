import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthedRequest, AuthGuard } from '../auth/auth.guard';
import type { Owner } from '../contacts/contacts.service';
import { PreferencesService } from './preferences.service';

const owner = (req: AuthedRequest): Owner => ({ tenantId: req.mailbox.tenantId, email: req.mailbox.email });

@Controller()
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(private readonly prefs: PreferencesService) {}

  @Get('preferences')
  get(@Req() req: AuthedRequest) {
    return this.prefs.get(owner(req));
  }

  @Patch('preferences')
  update(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.prefs.update(owner(req), body);
  }

  @Delete('preferences')
  @HttpCode(204)
  async reset(@Req() req: AuthedRequest) {
    await this.prefs.reset(owner(req));
  }

  @Get('signatures')
  signatures(@Req() req: AuthedRequest) {
    return this.prefs.listSignatures(owner(req));
  }

  @Post('signatures')
  createSignature(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.prefs.createSignature(owner(req), body);
  }

  @Put('signatures/:id')
  updateSignature(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.prefs.updateSignature(owner(req), id, body);
  }

  @Delete('signatures/:id')
  @HttpCode(204)
  async removeSignature(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.prefs.removeSignature(owner(req), id);
  }
}

import { Controller, Get, Query, Res, UseGuards, Req } from '@nestjs/common';
import { Response } from 'express';
import { GoogleService } from './google.service';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('integrations/google')
export class GoogleController {
  constructor(private readonly googleService: GoogleService) {}

  @Get('auth')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getAuthUrl(@CurrentUser() user: RequestUser, @Res() res: Response) {
    const url = this.googleService.getAuthorizationUrl(user.tenantId);
    return res.json({ url });
  }

  @Get('callback')
  async handleCallback(
    @Query('code') code: string, 
    @Query('state') state: string, 
    @Res() res: Response
  ) {
    const FRONTEND_URL = `${process.env.INVITE_FRONTEND_URL || 'http://localhost:3001'}/getting-started`;
    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}?error=missing_code`);
    }

    try {
      await this.googleService.handleCallback(code, state);
      return res.redirect(`${FRONTEND_URL}?success=google_connected`);
    } catch (e) {
      return res.redirect(`${FRONTEND_URL}?error=oauth_failed`);
    }
  }
}

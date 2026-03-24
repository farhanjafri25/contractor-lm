import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SlackService } from './slack.service';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  @Get('install')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  install(@CurrentUser() user: RequestUser, @Res() res: Response) {
    const url = this.slackService.getInstallUrl(user.tenantId, user.userId);
    return res.json({ url });
  }

  @Get('oauth/callback')
  async oauthRedirect(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontendUrl =
      this.configService.get<string>('frontendUrl') || 'http://localhost:3001';

    if (error) {
      return res.redirect(
        `${frontendUrl}/settings/integrations?error=slack_${error}`,
      );
    }

    try {
      await this.slackService.handleOAuthCallback(code, state);
      return res.redirect(`${frontendUrl}/settings/integrations?success=slack`);
    } catch (e) {
      return res.redirect(
        `${frontendUrl}/settings/integrations?error=slack_failed`,
      );
    }
  }

  @Post('interactions')
  async handleInteractions(@Req() req: Request, @Res() res: Response) {
    let payload;
    try {
      payload = JSON.parse(req.body.payload);
    } catch (e) {
      return res.status(400).send('Invalid payload');
    }

    if (payload.type === 'block_actions') {
      // Intentionally not awaiting here to avoid Slack 3s timeout
      this.slackService.handleInteractionPayload(payload).catch(err => {
        console.error('Error handling Slack interaction payload', err);
      });
    }

    return res.status(200).send();
  }
}

import { Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SlackAppService } from './slack-app.service';
import {
  JwtAuthGuard,
  RolesGuard,
  Roles,
} from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('slack')
export class SlackAppController {
  constructor(
    private readonly slackService: SlackAppService,
    private readonly configService: ConfigService,
  ) {}


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

import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiService } from './ai.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) { }

  @Post('chat')
  async chat(
    @CurrentUser() user: RequestUser,
    @Body('messages') messages: any[],
  ) {
    return this.aiService.handleChat(user.tenantId, messages);
  }
}

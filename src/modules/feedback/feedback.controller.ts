import { Controller, Post, Get, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types';

@Controller('feedback')
export class FeedbackController {
    constructor(private readonly feedbackService: FeedbackService) {}

    // POST /feedback
    @Post()
    @UseGuards(JwtAuthGuard) // Require auth for submissions as planned
    @HttpCode(HttpStatus.CREATED)
    create(
        @CurrentUser() user: RequestUser,
        @Body() dto: CreateFeedbackDto,
    ) {
        return this.feedbackService.create(dto, user.tenantId, user.userId);
    }

    // GET /feedback  (Global view for developers)
    @Get()
    @UseGuards(JwtAuthGuard, RolesGuard)
    @Roles('admin', 'security') // For now, allow admins but knows it's global
    findAll() {
        return this.feedbackService.findAll();
    }
}

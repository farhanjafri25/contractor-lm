import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SponsorService } from './sponsor.service';
import { CreateSponsorActionDto, ReviewSponsorActionDto, ListSponsorActionsDto } from './dto/sponsor-action.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('sponsor/actions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) { }

  // GET /sponsor/actions
  // Owner/Admin sees all; sponsor sees only their own
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() query: ListSponsorActionsDto) {
    const isSponsor = user.role === 'sponsor';
    const sponsorIdFilter = isSponsor ? user.userId : undefined;
    return this.sponsorService.findAll(user.tenantId, query, sponsorIdFilter);
  }

  // GET /sponsor/actions/:id
  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.sponsorService.findOne(id, user.tenantId);
  }

  // POST /sponsor/actions  — sponsor submits extension or termination request
  @Post()
  @Roles('owner', 'admin', 'sponsor')
  @HttpCode(HttpStatus.CREATED)
  submit(@CurrentUser() user: RequestUser, @Body() dto: CreateSponsorActionDto) {
    return this.sponsorService.submit(dto, user.tenantId, user.userId);
  }

  // PATCH /sponsor/actions/:id/review  — owner/admin approves or rejects
  @Patch(':id/review')
  @Roles('owner', 'admin')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReviewSponsorActionDto,
  ) {
    return this.sponsorService.review(id, user.tenantId, user.userId, dto);
  }
}

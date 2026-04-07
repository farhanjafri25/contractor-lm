import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  /**
   * GET /applications
   * Lists all connected apps for the current tenant.
   */
  @Get()
  @Roles('admin', 'sponsor', 'viewer')
  findAll(@CurrentUser() user: RequestUser) {
    return this.applicationsService.findAll(user.tenantId);
  }
}

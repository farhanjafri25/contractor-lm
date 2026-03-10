import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'security', 'viewer')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  /**
   * GET /dashboard/summary
   * All KPI cards in one call — active, suspended, expiring soon,
   * overdue access, failed revocations, and department breakdown.
   */
  @Get('summary')
  getSummary(@CurrentUser() user: RequestUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getSummary(user.tenantId, query);
  }

  /**
   * GET /dashboard/expiring
   * Paginated list sorted by end_date ASC — drives the "Expiring Soon" table.
   */
  @Get('expiring')
  getExpiring(@CurrentUser() user: RequestUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getExpiring(user.tenantId, query);
  }

  /**
   * GET /dashboard/overdue
   * Expired contracts that still have un-revoked access — critical security gap.
   */
  @Get('overdue')
  getOverdue(@CurrentUser() user: RequestUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getOverdue(user.tenantId, query);
  }

  /**
   * GET /dashboard/at-risk
   * Suspended contractors + failed revocation records — items needing manual action.
   */
  @Get('at-risk')
  getAtRisk(@CurrentUser() user: RequestUser, @Query() query: DashboardQueryDto) {
    return this.dashboardService.getAtRisk(user.tenantId, query);
  }
}

import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { EventsService } from './events.service';
import { ListEventsDto } from './dto/list-events.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'security', 'viewer', 'sponsor')
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  /**
   * GET /events
   * Main audit log query — supports all filter combinations:
   * ?event_type=contract.suspended
   * ?category=access
   * ?contractor_id=...&from=2025-01-01&to=2025-03-01
   * ?actor_id=...&page=2&limit=50
   */
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() query: ListEventsDto) {
    return this.eventsService.findAll(user.tenantId, query);
  }

  /**
   * GET /events/stats
   * Aggregated event counts by type + daily volume for last 30 days.
   * Useful for dashboard charts and trend indicators.
   * Must be defined BEFORE :id to avoid route conflict.
   */
  @Get('stats')
  getStats(@CurrentUser() user: RequestUser, @Query() query: ListEventsDto) {
    return this.eventsService.getStats(user.tenantId, query);
  }

  /**
   * GET /events/contractor/:contractorId
   * Full timeline for a single contractor — sorted newest first.
   * Used in the contractor detail drawer/page.
   */
  @Get('contractor/:contractorId')
  getContractorTimeline(
    @CurrentUser() user: RequestUser,
    @Param('contractorId') contractorId: string,
    @Query() query: ListEventsDto,
  ) {
    return this.eventsService.getContractorTimeline(contractorId, user.tenantId, query);
  }

  /**
   * GET /events/:id
   * Full detail of a single event including all populated references.
   */
  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.eventsService.findOne(id, user.tenantId);
  }
}

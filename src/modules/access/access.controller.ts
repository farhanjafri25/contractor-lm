import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AccessService } from './access.service';
import { ListAccessDto, UpdateAccessDto } from './dto/access.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

@Controller('access')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AccessController {
  constructor(private readonly accessService: AccessService) { }

  /**
   * GET /access
   * All provisioning records for the tenant.
   * Filterable by ?status=failed&contractor_id=...&tenant_application_id=...
   */
  @Get()
  @Roles('admin', 'security', 'viewer')
  findAll(@CurrentUser() user: RequestUser, @Query() query: ListAccessDto) {
    return this.accessService.findAll(user.tenantId, query);
  }

  /**
   * GET /access/contract/:contractId
   * Full provisioning picture for a single contract — used in the contractor drawer.
   * Returns contract metadata + all access records + per-status summary counts.
   * Must be defined before :id to avoid route shadowing.
   */
  @Get('contract/:contractId')
  @Roles('admin', 'security', 'viewer')
  findByContract(
    @CurrentUser() user: RequestUser,
    @Param('contractId') contractId: string,
  ) {
    return this.accessService.findByContract(contractId, user.tenantId);
  }

  /**
   * GET /access/:id
   * Single access record with all references populated.
   */
  @Get(':id')
  @Roles('admin', 'security', 'viewer')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accessService.findOne(id, user.tenantId);
  }

  /**
   * PATCH /access/:id
   * Admin correction — override external_account_id or access_role.
   * Useful when an account was provisioned with wrong metadata.
   */
  @Patch(':id')
  @Roles('admin', 'security')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateAccessDto,
  ) {
    return this.accessService.update(id, user.tenantId, user.userId, dto);
  }

  /**
   * POST /access/:id/retry-revocation
   * Re-queues a failed revocation job. Guards against > MAX_ATTEMPTS.
   */
  @Post(':id/retry-revocation')
  @Roles('admin', 'security')
  @HttpCode(HttpStatus.OK)
  retryRevocation(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accessService.retryRevocation(id, user.tenantId, user.userId);
  }

  /**
   * POST /access/:id/mark-resolved
   * Admin acknowledges a failed record that was manually cleaned up externally.
   * Marks as revoked + logs lifecycle event.
   */
  @Post(':id/mark-resolved')
  @Roles('admin', 'security')
  @HttpCode(HttpStatus.OK)
  markResolved(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.accessService.markResolved(id, user.tenantId, user.userId);
  }
}

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
import { TenantsService } from './tenants.service';
import { UpdateTenantDto, InviteUserDto, UpdateUserRoleDto, ListUsersDto } from './dto/tenant.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

// All routes are tenant-scoped via the JWT — no tenantId in URL needed
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) { }

  // ─────────────────────────────────────────────────────────
  // TENANT PROFILE
  // ─────────────────────────────────────────────────────────

  /** GET /tenants/me */
  @Get('me')
  getProfile(@CurrentUser() user: RequestUser) {
    return this.tenantsService.getProfile(user.tenantId);
  }

  /** GET /tenants/me/stats */
  @Get('me/stats')
  getStats(@CurrentUser() user: RequestUser) {
    return this.tenantsService.getStats(user.tenantId);
  }

  /** PATCH /tenants/me — admin only */
  @Patch('me')
  @Roles('admin')
  updateProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.updateProfile(user.tenantId, dto);
  }

  // ─────────────────────────────────────────────────────────
  // USER MANAGEMENT
  // ─────────────────────────────────────────────────────────

  /** GET /tenants/me/users */
  @Get('me/users')
  listUsers(@CurrentUser() user: RequestUser, @Query() query: ListUsersDto) {
    return this.tenantsService.listUsers(user.tenantId, query);
  }

  /** GET /tenants/me/users/:id */
  @Get('me/users/:id')
  getUser(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tenantsService.getUser(id, user.tenantId);
  }

  /** POST /tenants/me/users — invite a new user (admin only) */
  @Post('me/users')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  inviteUser(@CurrentUser() user: RequestUser, @Body() dto: InviteUserDto) {
    return this.tenantsService.inviteUser(dto, user.tenantId, user.userId);
  }

  /** PATCH /tenants/me/users/:id/role — change role (admin only) */
  @Patch('me/users/:id/role')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  updateUserRole(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.tenantsService.updateUserRole(id, user.tenantId, user.userId, dto);
  }

  /** POST /tenants/me/users/:id/deactivate (admin only) */
  @Post('me/users/:id/deactivate')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  deactivateUser(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tenantsService.deactivateUser(id, user.tenantId, user.userId);
  }

  /** POST /tenants/me/users/:id/reactivate (admin only) */
  @Post('me/users/:id/reactivate')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  reactivateUser(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tenantsService.reactivateUser(id, user.tenantId);
  }

  /** POST /tenants/me/users/:id/set-password (admin only) */
  @Post('me/users/:id/set-password')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  setPassword(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body('password') password: string,
  ) {
    return this.tenantsService.setPassword(id, user.tenantId, password);
  }
}

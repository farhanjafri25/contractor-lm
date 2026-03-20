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
import { UpdateTenantDto, InviteUserDto, ListUsersDto, UpdateUserProfileDto } from './dto/tenant.dto';
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
  // USER MANAGEMENT & PROFILE
  // ─────────────────────────────────────────────────────────

  /** GET /tenants/me/user (Get current logged-in user details) */
  @Get('me/user')
  getUserProfile(@CurrentUser() user: RequestUser) {
    return this.tenantsService.getUserProfile(user.tenantId, user.userId);
  }

  /** PATCH /tenants/me/user (Update current user's personal profile) */
  @Patch('me/user')
  updateUserProfile(@CurrentUser() user: RequestUser, @Body() dto: UpdateUserProfileDto) {
    return this.tenantsService.updateUserProfile(user.tenantId, user.userId, dto);
  }

  /** GET /tenants/me/users */
  @Get('me/users')
  listUsers(@CurrentUser() user: RequestUser, @Query() query: ListUsersDto) {
    return this.tenantsService.listUsers(user.tenantId, query);
  }

  /** GET /tenants/me/pending-users (admin only) */
  @Get('me/pending-users')
  @Roles('admin')
  listPendingUsers(@CurrentUser() user: RequestUser) {
    return this.tenantsService.listPendingUsers(user.tenantId);
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

  /** POST /tenants/me/users/:id/approve (admin only) */
  @Post('me/users/:id/approve')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  approveUser(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tenantsService.approveUser(id, user.tenantId);
  }

  /** POST /tenants/me/users/:id/reject (admin only) */
  @Post('me/users/:id/reject')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  rejectUser(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.tenantsService.rejectUser(id, user.tenantId);
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

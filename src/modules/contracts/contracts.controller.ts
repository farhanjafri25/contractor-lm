import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { SuspendContractDto, ReactivateContractDto, ExtendContractDto } from './dto/contract-actions.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';

// All endpoints are nested under /contractors/:contractorId/contracts/:contractId
@Controller('contractors/:contractorId/contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) { }

  // GET /contractors/:contractorId/contracts/:id
  @Get(':id')
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.contractsService.findOne(id, user.tenantId);
  }

  // POST /contractors/:contractorId/contracts/:id/suspend
  @Post(':id/suspend')
  @Roles('admin', 'security')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: SuspendContractDto,
  ) {
    return this.contractsService.suspend(id, user.tenantId, user.userId, dto);
  }

  // POST /contractors/:contractorId/contracts/:id/reactivate
  @Post(':id/reactivate')
  @Roles('admin', 'security')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ReactivateContractDto,
  ) {
    return this.contractsService.reactivate(id, user.tenantId, user.userId, dto);
  }

  // PATCH /contractors/:contractorId/contracts/:id/extend  (admin fast-path)
  @Patch(':id/extend')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: ExtendContractDto,
  ) {
    return this.contractsService.extend(id, user.tenantId, user.userId, dto);
  }

  // POST /contractors/:contractorId/contracts/:id/terminate
  @Post(':id/terminate')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  terminate(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ) {
    return this.contractsService.terminate(id, user.tenantId, user.userId);
  }
}

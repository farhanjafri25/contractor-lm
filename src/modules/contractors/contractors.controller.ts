import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContractorsService } from './contractors.service';
import { CreateContractorDto } from './dto/create-contractor.dto';
import { UpdateContractorDto } from './dto/update-contractor.dto';
import { ListContractorsDto } from './dto/list-contractors.dto';
import { JwtAuthGuard, RolesGuard, Roles } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types';
import { IsObject, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

class ImportContractorsDto {
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  field_mapping?: Record<string, string>;
  // e.g. { "Full Name": "name", "End Date": "end_date", "Sponsor Email": "sponsor_id" }
}

@Controller('contractors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContractorsController {
  constructor(private readonly contractorsService: ContractorsService) { }

  // GET /contractors
  @Get()
  findAll(@CurrentUser() user: RequestUser, @Query() query: ListContractorsDto) {
    return this.contractorsService.findAll(user.tenantId, query);
  }

  // GET /contractors/:id
  @Get(':id')
  findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.contractorsService.findOne(id, user.tenantId);
  }

  // POST /contractors
  @Post()
  @Roles('admin', 'sponsor')
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateContractorDto) {
    return this.contractorsService.create(dto, user.tenantId, user.userId, user.role);
  }

  // POST /contractors/:id/contracts  (rehire)
  @Post(':id/contracts')
  @Roles('admin', 'sponsor')
  @HttpCode(HttpStatus.CREATED)
  rehire(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateContractorDto,
  ) {
    return this.contractorsService.createContractForExistingIdentity(
      id,
      dto,
      user.tenantId,
      user.userId,
      user.role,
    );
  }

  // PATCH /contractors/:id
  @Patch(':id')
  @Roles('admin', 'sponsor')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateContractorDto,
  ) {
    return this.contractorsService.update(id, user.tenantId, dto);
  }

  // POST /contractors/import   (CSV bulk upload)
  @Post('import')
  @Roles('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file'))
  import(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: ImportContractorsDto,
  ) {
    return this.contractorsService.importFromCsv(
      file.buffer,
      body.field_mapping ?? {},
      user.tenantId,
      user.userId,
    );
  }
}

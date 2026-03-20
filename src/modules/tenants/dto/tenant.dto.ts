import {
    IsString,
    IsOptional,
    IsEmail,
    IsEnum,
    IsNumber,
    IsPositive,
    Min,
    Max,
} from 'class-validator';
import { TenantPlan } from '../../../schemas/tenant.schema';

export class UpdateTenantDto {
    @IsOptional()
    @IsString()
    tenant_name?: string;

    @IsOptional()
    @IsEnum(TenantPlan)
    plan?: TenantPlan;

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Min(1)
    @Max(10000)
    contractor_seat_limit?: number;
}

// ─────────────────────────────────────────────────────────
// User management DTOs
// ─────────────────────────────────────────────────────────

import { UserRole } from '../../../schemas/tenant-user.schema';

export class InviteUserDto {
    @IsEmail()
    email: string;
}

export class UpdateUserProfileDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    info?: string;
}

export class ListUsersDto {
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @IsOptional()
    @IsString()
    status?: string;
}

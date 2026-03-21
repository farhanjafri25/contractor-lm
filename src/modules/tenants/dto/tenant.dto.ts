import {
    IsString,
    IsOptional,
    IsEmail,
    IsEnum,
    IsNumber,
    IsPositive,
    Min,
    Max,
    IsBoolean,
} from 'class-validator';
import { TenantPlan } from '../../../schemas/tenant.schema';

export class UpdateTenantDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsEnum(TenantPlan)
    plan?: TenantPlan;

    @IsOptional()
    @IsNumber()
    @IsPositive()
    @Min(1)
    @Max(10000)
    contractor_seat_limit?: number;

    @IsOptional()
    @IsString()
    logo?: string;

    @IsOptional()
    @IsString()
    slug?: string;

    @IsOptional()
    @IsString()
    billing_country?: string;

    @IsOptional()
    @IsString()
    company_size?: string;

    @IsOptional()
    @IsString()
    tracking_method?: string;

    @IsOptional()
    @IsString()
    contractor_volume?: string;

    @IsOptional()
    @IsString()
    directory_provider?: string;
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

    @IsOptional()
    @IsString()
    avatar?: string;

    @IsOptional()
    @IsBoolean()
    marketing_opt_in?: boolean;
}

export class ListUsersDto {
    @IsOptional()
    @IsEnum(UserRole)
    role?: UserRole;

    @IsOptional()
    @IsString()
    status?: string;
}

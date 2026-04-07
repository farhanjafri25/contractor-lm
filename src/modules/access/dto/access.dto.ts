import { IsOptional, IsEnum, IsString, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ProvisioningStatus } from '../../../schemas/contractor-access.schema';

export class ListAccessDto {
    /** Filter by provisioning status */
    @IsOptional()
    @IsEnum(ProvisioningStatus)
    status?: ProvisioningStatus;

    /** Filter by contract */
    @IsOptional()
    @IsString()
    contract_id?: string;

    /** Filter by contractor identity */
    @IsOptional()
    @IsString()
    contractor_id?: string;

    /** Filter by application */
    @IsOptional()
    @IsString()
    tenant_application_id?: string;
}

export class UpdateAccessDto {
    /** Override the external account ID linked in the remote app */
    @IsOptional()
    @IsString()
    external_account_id?: string;

    /** Override the role assigned in the remote app */
    @IsOptional()
    @IsString()
    access_role?: string;
}

export class SyncAccessItemDto {
    @IsString()
    tenant_application_id: string;

    @IsOptional()
    @IsString()
    access_role?: string;
}

export class SyncAccessDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncAccessItemDto)
    access_items: SyncAccessItemDto[];

    @IsOptional()
    @IsBoolean()
    create_google_account?: boolean;

    @IsOptional()
    @IsBoolean()
    create_slack_account?: boolean;
}

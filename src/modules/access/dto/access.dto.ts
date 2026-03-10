import { IsOptional, IsEnum, IsString } from 'class-validator';
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

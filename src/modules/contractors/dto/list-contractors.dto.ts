import { IsOptional, IsString, IsEnum, IsNumberString } from 'class-validator';
import { ContractStatus } from '../../../schemas/contractor-contract.schema';

export class ListContractorsDto {
    @IsOptional()
    @IsEnum(ContractStatus)
    status?: ContractStatus;

    @IsOptional()
    @IsString()
    department?: string;

    @IsOptional()
    @IsString()
    sponsor_id?: string;

    @IsOptional()
    @IsString()
    search?: string; // matches name or email

    @IsOptional()
    @IsNumberString()
    page?: string = '1';

    @IsOptional()
    @IsNumberString()
    limit?: string = '20';
}

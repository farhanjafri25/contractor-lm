import {
    IsString,
    IsEmail,
    IsOptional,
    IsDateString,
    IsBoolean,
    IsArray,
    ValidateNested,
    IsMongoId,
    ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ApplicationAccessDto {
    @IsMongoId()
    tenant_application_id: string;

    @IsOptional()
    @IsString()
    access_role?: string;

    @IsOptional()
    @IsString()
    external_account_id?: string;
}

export class CreateContractDto {
    @IsDateString()
    start_date: string;

    @IsDateString()
    end_date: string;

    @IsOptional()
    @IsBoolean()
    create_google_account?: boolean = false;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ApplicationAccessDto)
    application_access?: ApplicationAccessDto[] = [];
}

export class CreateContractorDto {
    @IsString()
    name: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    job_title?: string;

    @IsOptional()
    @IsString()
    department?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsString()
    location?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @ValidateNested()
    @Type(() => CreateContractDto)
    contract: CreateContractDto;
}

export class BulkCreateContractorsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateContractorDto)
    contractors: CreateContractorDto[];
}

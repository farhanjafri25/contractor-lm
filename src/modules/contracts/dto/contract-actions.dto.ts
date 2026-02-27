import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';

export enum SuspendReason {
    COMPLIANCE = 'compliance',
    PERFORMANCE = 'performance',
    SECURITY = 'security',
    OTHER = 'other',
}

export class SuspendContractDto {
    @IsEnum(SuspendReason)
    reason: SuspendReason;

    @IsOptional()
    @IsString()
    note?: string;
}

export class ReactivateContractDto {
    @IsOptional()
    @IsString()
    note?: string;
}

export class ExtendContractDto {
    @IsDateString()
    new_end_date: string;

    @IsOptional()
    @IsString()
    note?: string;
}

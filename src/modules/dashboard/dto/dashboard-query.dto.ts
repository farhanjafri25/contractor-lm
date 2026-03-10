import { IsOptional, IsNumber, IsPositive, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class DashboardQueryDto {
    /**
     * How many days ahead to look for "expiring soon" contracts.
     * Defaults to 30.
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @IsPositive()
    @Min(1)
    @Max(90)
    expiring_within_days?: number = 30;

    /**
     * Page size for list endpoints (expiring, overdue).
     */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number = 20;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;
}

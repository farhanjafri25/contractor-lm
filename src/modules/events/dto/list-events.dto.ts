import { IsOptional, IsEnum, IsString, IsNumber, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { EventType, ActorType } from '../../../schemas/lifecycle-event.schema';

export class ListEventsDto {
    /** Filter by a specific event type, e.g. contractor.created */
    @IsOptional()
    @IsEnum(EventType)
    event_type?: EventType;

    /** Filter by actor type: user | system | sponsor */
    @IsOptional()
    @IsEnum(ActorType)
    actor_type?: ActorType;

    /** Filter events for a specific contractor identity */
    @IsOptional()
    @IsString()
    contractor_id?: string;

    /** Filter events for a specific contract */
    @IsOptional()
    @IsString()
    contract_id?: string;

    /** Filter events for a specific user (actor) */
    @IsOptional()
    @IsString()
    actor_id?: string;

    /** Filter event category by prefix: contractor | access | contract | sponsor | directory */
    @IsOptional()
    @IsString()
    category?: string;

    /** ISO date string — only return events on or after this date */
    @IsOptional()
    @IsDateString()
    from?: string;

    /** ISO date string — only return events on or before this date */
    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(1)
    @Max(100)
    limit?: number = 25;
}

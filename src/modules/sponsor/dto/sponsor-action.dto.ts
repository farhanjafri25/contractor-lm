import {
    IsString,
    IsOptional,
    IsDateString,
    IsEnum,
    IsMongoId,
} from 'class-validator';
import { SponsorActionType } from '../../../schemas/sponsor-action.schema';

export class CreateSponsorActionDto {
    @IsMongoId()
    contract_id: string;

    @IsEnum(SponsorActionType)
    action_type: SponsorActionType;

    @IsOptional()
    @IsDateString()
    proposed_end_date?: string;

    @IsString()
    justification: string;
}

export enum ReviewDecision {
    APPROVED = 'approved',
    REJECTED = 'rejected',
}

export class ReviewSponsorActionDto {
    @IsEnum(ReviewDecision)
    decision: ReviewDecision;

    @IsOptional()
    @IsString()
    review_note?: string;
}

export class ListSponsorActionsDto {
    @IsOptional()
    @IsString()
    status?: string;  // pending | approved | rejected

    @IsOptional()
    @IsString()
    contract_id?: string;
}

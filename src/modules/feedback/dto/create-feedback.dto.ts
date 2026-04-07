import { IsEnum, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { FeedbackCategory } from '../../../schemas/feedback.schema';
import { Type } from 'class-transformer';

export class CreateFeedbackDto {
    @IsEnum(FeedbackCategory)
    @IsNotEmpty()
    category: FeedbackCategory;

    @IsString()
    @IsNotEmpty()
    message: string;

    @IsOptional()
    @IsNumber()
    @Min(1)
    @Max(5)
    @Type(() => Number)
    rating?: number;

    @IsOptional()
    @IsObject()
    metadata?: Record<string, any>;
}

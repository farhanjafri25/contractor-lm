import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Feedback, FeedbackDocument } from '../../schemas/feedback.schema';
import { CreateFeedbackDto } from './dto/create-feedback.dto';

@Injectable()
export class FeedbackService {
    private readonly logger = new Logger(FeedbackService.name);

    constructor(
        @InjectModel(Feedback.name)
        private feedbackModel: Model<FeedbackDocument>,
    ) {}

    async create(dto: CreateFeedbackDto, tenantId?: string, userId?: string) {
        this.logger.log(`[Feedback] New Dev-Feedback submitted. User: ${userId}, Tenant: ${tenantId}`);
        
        const feedbackData: Partial<Feedback> = {
            category: dto.category,
            message: dto.message,
            rating: dto.rating,
            metadata: dto.metadata || {},
        };

        if (tenantId) {
            feedbackData.tenant_id = new Types.ObjectId(tenantId);
        }
        
        if (userId) {
            feedbackData.user_id = new Types.ObjectId(userId);
        }

        const newFeedback = await this.feedbackModel.create(feedbackData);
        return newFeedback;
    }

    async findAll() {
        // Global view for developers (not filtered by tenant)
        return this.feedbackModel.find({}).sort({ createdAt: -1 }).lean();
    }
}

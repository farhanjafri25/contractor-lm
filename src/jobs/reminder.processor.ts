import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractorContract, ContractorContractDocument, ContractStatus } from '../schemas/contractor-contract.schema';
import { SlackService } from '../modules/slack/slack.service';

@Injectable()
export class ReminderProcessor {
    private readonly logger = new Logger(ReminderProcessor.name);

    constructor(
        @InjectModel(ContractorContract.name)
        private contractModel: Model<ContractorContractDocument>,
        private slackService: SlackService,
    ) { }

    // Changed to EVERY_MINUTE for easy local testing!
    // Change back to CronExpression.EVERY_DAY_AT_9AM when ready for production.
    @Cron(CronExpression.EVERY_DAY_AT_10AM)
    async processReminders() {
        const start = new Date();
        start.setDate(start.getDate() + 7);
        start.setHours(0,0,0,0);
        
        const end = new Date(start);
        end.setHours(23,59,59,999);

        const expiringContracts = await this.contractModel.find({
            end_date: { $gte: start, $lte: end },
            status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
        }).populate('contractor_id', 'name email').populate('sponsor_id', 'email name');

        for (const contract of expiringContracts) {
            try {
                const contractorEmail = (contract as any).contractor_id?.email;
                if (contractorEmail) {
                    await this.slackService.sendInteractiveReminder(
                        contract.tenant_id.toString(),
                        contractorEmail,
                        contract._id.toString(),
                        contract.end_date
                    );
                }
            } catch (error) {
                this.logger.error(`Failed to send reminder for contract ${contract._id}: ${error.message}`);
            }
        }

        if (expiringContracts.length > 0) {
            this.logger.log(`Sent reminders for ${expiringContracts.length} expiring contracts`);
        }
    }
}

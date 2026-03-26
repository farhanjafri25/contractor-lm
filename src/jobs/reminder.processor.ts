import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractorContract, ContractorContractDocument, ContractStatus } from '../schemas/contractor-contract.schema';
import { SponsorAction, SponsorActionDocument, SponsorActionStatus } from '../schemas/sponsor-action.schema';
import { SlackService } from '../modules/slack/slack.service';

@Injectable()
export class ReminderProcessor {
    private readonly logger = new Logger(ReminderProcessor.name);

    constructor(
        @InjectModel(ContractorContract.name)
        private contractModel: Model<ContractorContractDocument>,
        @InjectModel(SponsorAction.name)
        private sponsorActionModel: Model<SponsorActionDocument>,
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

        let sent = 0;
        for (const contract of expiringContracts) {
            try {
                // Skip if a pending action already exists (sponsor already acted, waiting for admin)
                const hasPendingAction = await this.sponsorActionModel.exists({
                    contract_id: contract._id,
                    status: SponsorActionStatus.PENDING,
                });
                if (hasPendingAction) {
                    this.logger.log(`Skipping reminder for contract ${contract._id} — pending action exists`);
                    continue;
                }

                const contractorEmail = (contract as any).contractor_id?.email;
                const contractorName = (contract as any).contractor_id?.name || 'Contractor';
                if (contractorEmail) {
                    await this.slackService.sendInteractiveReminder(
                        contract.tenant_id.toString(),
                        contractorEmail,
                        contractorName,
                        contract._id.toString(),
                        contract.end_date
                    );
                    sent++;
                }
            } catch (error) {
                this.logger.error(`Failed to send reminder for contract ${contract._id}: ${error.message}`);
            }
        }

        if (sent > 0) {
            this.logger.log(`Sent reminders for ${sent} expiring contracts`);
        }
    }
}

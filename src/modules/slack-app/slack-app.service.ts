import {
  Injectable,
  InternalServerErrorException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from '../../schemas/tenant.schema';
import { TenantUser, TenantUserDocument } from '../../schemas/tenant-user.schema';
import { ContractorContract, ContractorContractDocument } from '../../schemas/contractor-contract.schema';
import { ContractsService } from '../contracts/contracts.service';
import { SponsorService } from '../sponsor/sponsor.service';
import { SponsorActionType } from '../../schemas/sponsor-action.schema';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackAppService {
  private readonly logger = new Logger(SlackAppService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(TenantUser.name) private readonly tenantUserModel: Model<TenantUserDocument>,
    @InjectModel(ContractorContract.name) private readonly contractModel: Model<ContractorContractDocument>,
    @Inject(forwardRef(() => ContractsService))
    private readonly contractsService: ContractsService,
    @Inject(forwardRef(() => SponsorService))
    private readonly sponsorService: SponsorService,
  ) {}

  async sendInteractiveReminder(
    tenantId: string,
    contractorEmail: string,
    contractorName: string,
    contractId: string,
    endDate: Date,
  ): Promise<void> {
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant || !tenant.slack_access_token) {
      this.logger.warn(`No active Slack integration for tenant ${tenantId}`);
      return;
    }

    const client = new WebClient(tenant.slack_access_token);
    const userResult = await client.users.lookupByEmail({ email: contractorEmail });

    if (!userResult.ok || !userResult.user?.id) {
      this.logger.error(`Could not find Slack user with email ${contractorEmail}: ${userResult.error}`);
      return;
    }

    const slackUserId = userResult.user.id;
    const formattedDate = new Date(endDate).toLocaleDateString();

    const result = await client.chat.postMessage({
      channel: slackUserId,
      text: `Reminder: Your contract expires on ${formattedDate}.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*📋 Contract Expiry Reminder*\n\n*Contractor:* ${contractorName} (${contractorEmail})\n*Expiry Date:* *${formattedDate}*\n\nYour contract is expiring in 7 days. Please choose an action below:`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Extend 30 Days' },
              style: 'primary',
              value: `extend_${contractId}`,
              action_id: 'contract_extend_30',
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '🛑 Terminate' },
              style: 'danger',
              value: `terminate_${contractId}`,
              action_id: 'contract_terminate',
            },
          ],
        },
      ],
    });

    if (!result.ok) {
      this.logger.error(`Failed to send Slack reminder: ${result.error}`);
    } else {
      this.logger.log(`Slack reminder sent to ${contractorEmail}`);
    }
  }

  async handleInteractionPayload(payload: any): Promise<void> {
    const teamId = payload.team?.id;
    if (!teamId) return;

    const tenant = await this.tenantModel.findOne({ slack_team_id: teamId });
    if (!tenant || !tenant.slack_access_token) return;

    const tenantIdStr = tenant._id.toString();
    const frontendUrl = this.configService.get<string>('frontendUrl') || 'http://localhost:3001';

    const action = payload.actions?.[0];
    if (!action) return;

    const actionId = action.action_id;
    const responseUrl = payload.response_url;
    const sponsorSlackId = payload.user?.id;

    const client = new WebClient(tenant.slack_access_token);

    try {
      const contractId = action.value.replace('extend_', '').replace('terminate_', '');
      const contract = await this.contractsService.findOne(contractId, tenantIdStr);
      
      const contractor = (contract as any).contractor_id;
      const contractorName: string = contractor?.name ?? 'Contractor';
      const contractorEmail: string = contractor?.email ?? '';

      const sponsorId = contract.sponsor_id || contract.created_by;
      const connectedByStr = sponsorId.toString();

      if (actionId === 'contract_extend_30') {
        const newEndDate = new Date(contract.end_date);
        newEndDate.setDate(newEndDate.getDate() + 30);

        await this.sponsorService.submit(
          {
            contract_id: contractId,
            action_type: SponsorActionType.EXTEND,
            proposed_end_date: newEndDate as any,
            justification: 'Extension requested via Slack (30 days)',
          },
          tenantIdStr,
          connectedByStr,
        );

        await this.updateMessage(
          responseUrl,
          `⏳ Extension request submitted for *${contractorName}* (${contractorEmail}). Awaiting admin approval.`,
        );

        if (sponsorSlackId) {
          await client.chat.postMessage({
            channel: sponsorSlackId,
            text: `Extension request submitted for ${contractorName}`,
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⏳ *Extension Request Submitted*\n\n*Contractor:* ${contractorName} (${contractorEmail})\n*Proposed End Date:* ${newEndDate.toLocaleDateString()}\n*Status:* Awaiting admin approval\n\n<${frontendUrl}/contracts/${contractId}|View Contract →>`,
              },
            }],
          });
        }
      } else if (actionId === 'contract_terminate') {
        await this.sponsorService.submit(
          {
            contract_id: contractId,
            action_type: SponsorActionType.TERMINATE,
            justification: 'Termination requested via Slack',
          },
          tenantIdStr,
          connectedByStr,
        );

        await this.updateMessage(
          responseUrl,
          `⏳ Termination request submitted for *${contractorName}* (${contractorEmail}). Awaiting admin approval.`,
        );

        if (sponsorSlackId) {
          await client.chat.postMessage({
            channel: sponsorSlackId,
            text: `Termination request submitted for ${contractorName}`,
            blocks: [{
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⏳ *Termination Request Submitted*\n\n*Contractor:* ${contractorName} (${contractorEmail})\n*Status:* Awaiting admin approval\n\n<${frontendUrl}/contracts/${contractId}|View Contract →>`,
              },
            }],
          });
        }
      }
    } catch (e: any) {
      this.logger.error(`Failed to handle Slack interaction: ${e.message}`);
      await this.updateMessage(responseUrl, `⚠️ Failed to process action: ${e.message}`);
    }
  }

  private async updateMessage(responseUrl: string, newText: string) {
    if (!responseUrl) return;
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ replace_original: true, text: newText })
    });
  }

  async sendOnboardingNotification(tenantId: string, contractId: string, firstName: string, lastName: string, email: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.slack_access_token) return;

    const client = new WebClient(tenant.slack_access_token);
    
    let targetChannel = await this.resolveSponsorChannel(client, contractId);
    
    if (!targetChannel) {
      targetChannel = await this.findDefaultChannel(client, tenant.slack_channel_id ?? undefined);
    }

    if (!targetChannel) {
      this.logger.error(`[Slack Bot] No channel found for onboarding notification for tenant ${tenant._id}`);
      return;
    }

    try {
      await client.chat.postMessage({
        channel: targetChannel,
        text: `New Contractor Onboarding: ${firstName} ${lastName}`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🚀 New Contractor Onboarding',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Name:* ${firstName} ${lastName}\n*Email:* ${email}\n*Role:* Contractor`,
            },
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: '⚠️ *Manual Action Required:* Automated Slack invitation natively failed. Please invite this user manually to your workspace.',
              },
            ],
          },
        ],
      });
      this.logger.log(`[Slack Bot] Posted onboarding notification to ${targetChannel}`);
    } catch (e: any) {
      this.logger.error(`[Slack Bot] Failed to post message to ${targetChannel}: ${e.message}`);
    }
  }

  async sendRevocationNotification(tenantId: string, contractId: string | undefined, email: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.slack_access_token) return;

    const client = new WebClient(tenant.slack_access_token);
    
    let targetChannel = contractId ? await this.resolveSponsorChannel(client, contractId) : undefined;
    
    if (!targetChannel) {
      targetChannel = await this.findDefaultChannel(client, tenant.slack_channel_id ?? undefined);
    }

    if (!targetChannel) {
      this.logger.error(`[Slack Bot] No channel found for revocation notification for tenant ${tenant._id}`);
      return;
    }

    try {
      await client.chat.postMessage({
        channel: targetChannel,
        text: `🚨 *Access Revocation Required*\nContract for *${email}* has ended. Please manually verify and deactivate their Slack account.`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🚨 Access Revocation Required',
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `The contract for *${email}* has ended, but automated Slack deactivation natively failed or the user wasn't found under that exact email. Please manually verify and deactivate them in your Slack workspace.`,
            },
          },
        ]
      });
      this.logger.log(`[Slack Bot] Sent manual deactivation notice to ${targetChannel} for ${email}`);
    } catch (postErr: any) {
      this.logger.error(`[Slack Bot] Failed to post revocation notice: ${postErr.message}`);
    }
  }

  private async resolveSponsorChannel(client: WebClient, contractId: string): Promise<string | undefined> {
    try {
      if (!contractId) return undefined;
      const contract = await this.contractModel.findById(contractId).lean();
      if (!contract) return undefined;

      const sponsorOrCreatorId = contract.sponsor_id || contract.created_by;
      if (!sponsorOrCreatorId) return undefined;

      const sponsor = await this.tenantUserModel.findById(sponsorOrCreatorId).lean();
      if (!sponsor || !sponsor.email) return undefined;

      const userLookup = await client.users.lookupByEmail({ email: sponsor.email });
      if (userLookup.ok && userLookup.user?.id) {
        return userLookup.user.id;
      }
    } catch (e: any) {
      this.logger.warn(`[Slack Bot] Could not resolve Sponsor Slack DM: ${e.message}`);
    }
    return undefined;
  }

  async findDefaultChannel(client: WebClient, configuredId?: string): Promise<string | undefined> {
    if (configuredId) return configuredId;

    try {
      const channels = await client.conversations.list({ 
        types: 'public_channel,private_channel', 
        limit: 100,
        exclude_archived: true
      });
      
      const target = channels.channels?.find(c => 
        ['it-admin', 'onboarding', 'hr'].includes(c.name || '')
      );
      
      return target?.id || undefined;
    } catch (e: any) {
      this.logger.error(`[Slack Bot] Failed to list channels: ${e.message}`);
      return undefined;
    }
  }
}

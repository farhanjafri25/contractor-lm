import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SlackIntegration,
  SlackIntegrationDocument,
} from '../../schemas/slack-integration.schema';
import { EncryptionService } from '../../common/services/encryption.service';
import { ContractsService } from '../contracts/contracts.service';
import { SponsorService } from '../sponsor/sponsor.service';
import { SponsorActionType } from '../../schemas/sponsor-action.schema';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly encryptionService: EncryptionService,
    @InjectModel(SlackIntegration.name)
    private readonly slackIntegrationModel: Model<SlackIntegrationDocument>,
    @Inject(forwardRef(() => ContractsService))
    private readonly contractsService: ContractsService,
    @Inject(forwardRef(() => SponsorService))
    private readonly sponsorService: SponsorService,
  ) {}

  getInstallUrl(tenantId: string, userId: string): string {
    const clientId = this.configService.get<string>('slack.clientId');
    const redirectUri = this.configService.get<string>('slack.redirectUri');

    if (!clientId || !redirectUri) {
      this.logger.error('Slack configuration missing');
      throw new InternalServerErrorException(
        'Slack integration is not fully configured.',
      );
    }

    const stateObj = { t: tenantId, u: userId };
    const stateEncoded = Buffer.from(JSON.stringify(stateObj)).toString(
      'base64url',
    );
    // Basic scopes needed for an organizational app/bot interaction
    const scopes = ['chat:write', 'users:read', 'users:read.email', 'im:write', 'commands'];

    return `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes.join(',')}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateEncoded}`;
  }

  async handleOAuthCallback(code: string, stateBase64: string): Promise<void> {
    const clientId = this.configService.get<string>('slack.clientId');
    const clientSecret = this.configService.get<string>('slack.clientSecret');
    const redirectUri = this.configService.get<string>('slack.redirectUri');

    if (!code || !stateBase64) {
      throw new BadRequestException(
        'Missing code or state parameter from Slack.',
      );
    }

    let tenantIdStr: string;
    let userIdStr: string;
    try {
      const decoded = Buffer.from(stateBase64, 'base64url').toString('utf8');
      const stateObj = JSON.parse(decoded);
      tenantIdStr = stateObj.t;
      userIdStr = stateObj.u;
    } catch (e) {
      throw new BadRequestException(
        'Invalid state parameter provided in OAuth callback.',
      );
    }

    const tenantId = new Types.ObjectId(tenantIdStr);
    const userId = new Types.ObjectId(userIdStr);

    const formData = new URLSearchParams();
    formData.append('client_id', clientId || '');
    formData.append('client_secret', clientSecret || '');
    formData.append('code', code);
    formData.append('redirect_uri', redirectUri || '');

    const response = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      this.logger.error('Slack OAuth Error:', data);
      throw new BadRequestException(
        `Slack OAuth failed: ${data.error || 'Unknown error'}`,
      );
    }

    const accessToken = data.access_token;
    const teamId = data.team.id;
    const teamName = data.team.name;
    const botUserId = data.bot_user_id;

    const encryptedToken = this.encryptionService.encrypt(accessToken);

    // Persist or update the integration parameters securely in MongoDB
    await this.slackIntegrationModel.findOneAndUpdate(
      { tenant_id: tenantId },
      {
        $set: {
          team_id: teamId,
          team_name: teamName,
          bot_user_id: botUserId,
          access_token_encrypted: encryptedToken,
          connected_by: userId,
          is_active: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async sendInteractiveReminder(
    tenantId: string,
    contractorEmail: string,
    contractorName: string,
    contractId: string,
    endDate: Date,
  ): Promise<void> {
    const integration = await this.slackIntegrationModel.findOne({
      tenant_id: new Types.ObjectId(tenantId),
      is_active: true,
    });

    if (!integration || !integration.access_token_encrypted) {
      this.logger.warn(`No active Slack integration for tenant ${tenantId}`);
      return;
    }

    const token = this.encryptionService.decrypt(integration.access_token_encrypted);
    const client = new WebClient(token);

    // 1. Lookup user by email
    const userResult = await client.users.lookupByEmail({ email: contractorEmail });

    if (!userResult.ok || !userResult.user?.id) {
      this.logger.error(`Could not find Slack user with email ${contractorEmail}: ${userResult.error}`);
      return;
    }

    const slackUserId = userResult.user.id;
    const formattedDate = new Date(endDate).toLocaleDateString();

    // 2. Send Block Kit message with contractor details
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

    const integration = await this.slackIntegrationModel.findOne({ team_id: teamId });
    if (!integration) return;

    const tenantIdStr = integration.tenant_id.toString();
    const connectedByStr = integration.connected_by.toString();
    const frontendUrl = this.configService.get<string>('frontendUrl') || 'http://localhost:3001';

    const action = payload.actions?.[0];
    if (!action) return;

    const actionId = action.action_id;
    const responseUrl = payload.response_url;
    const sponsorSlackId = payload.user?.id;

    const token = this.encryptionService.decrypt(integration.access_token_encrypted);
    const client = new WebClient(token);

    try {
      const contract = await this.contractsService.findOne(
        action.value.replace('extend_', '').replace('terminate_', ''),
        tenantIdStr
      );
      const contractor = (contract as any).contractor_id;
      const contractorName: string = contractor?.name ?? 'Contractor';
      const contractorEmail: string = contractor?.email ?? '';
      const contractId = contract._id.toString();

      if (actionId === 'contract_extend_30') {
        const newEndDate = new Date(contract.end_date);
        newEndDate.setDate(newEndDate.getDate() + 30);

        // Submit through sponsor approval flow
        const sponsorAction = await this.sponsorService.submit(
          {
            contract_id: contractId,
            action_type: SponsorActionType.EXTEND,
            proposed_end_date: newEndDate as any,
            justification: 'Extension requested via Slack (30 days)',
          },
          tenantIdStr,
          connectedByStr,
        );

        // Update the original Slack message
        await this.updateMessage(
          responseUrl,
          `⏳ Extension request submitted for *${contractorName}* (${contractorEmail}). Awaiting admin approval.`,
        );

        // Notify sponsor
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
        // Submit terminate through approval flow  
        await this.sponsorService.submit(
          {
            contract_id: contractId,
            action_type: SponsorActionType.TERMINATE,
            justification: 'Termination requested via Slack',
          },
          tenantIdStr,
          connectedByStr,
        );

        // Update the original Slack message
        await this.updateMessage(
          responseUrl,
          `⏳ Termination request submitted for *${contractorName}* (${contractorEmail}). Awaiting admin approval.`,
        );

        // Notify sponsor
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
}

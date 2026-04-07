import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from '../../schemas/tenant.schema';
import { Application, ApplicationDocument } from '../../schemas/application.schema';
import { TenantApplication, TenantApplicationDocument, TenantApplicationStatus } from '../../schemas/tenant-application.schema';
import { WebClient } from '@slack/web-api';
// Using aliased import to avoid conflicts with this service's name 'SlackService'
import { SlackAppService as SlackBotService } from '../slack-app/slack-app.service';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(Application.name) private applicationModel: Model<ApplicationDocument>,
    @InjectModel(TenantApplication.name) private tenantApplicationModel: Model<TenantApplicationDocument>,
    private readonly slackBotService: SlackBotService,
  ) {}

  getAuthorizationUrl(tenantId: string, botOnly: boolean = false): string {
    const clientId = process.env.SLACK_CLIENT_ID || '';
    const redirectUri = process.env.SLACK_REDIRECT_URI || '';
    
    // Scopes combined from Integration (Users/SCIM logic) & Bot (interactive messages logic)
    const botScopes = [
      'chat:write',
      'chat:write.public',
      'channels:read',
      'groups:read',
      'im:read',
      'im:write',
      'mpim:read',
      'users:read',
      'users:read.email',
      'commands'
    ].join(',');

    const userScopes = botOnly ? '' : ['admin'].join(',');

    let url = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${botScopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${tenantId}`;
    if (userScopes) {
      url += `&user_scope=${userScopes}`;
    }
    return url;
  }

  async handleCallback(code: string, tenantId: string) {
    const client = new WebClient();
    try {
      const result = await client.oauth.v2.access({
        client_id: process.env.SLACK_CLIENT_ID || '',
        client_secret: process.env.SLACK_CLIENT_SECRET || '',
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI || '',
      });

      if (result.ok) {
        const botToken = result.access_token;
        const userToken = result.authed_user?.access_token;
        const teamId = result.team?.id || null;
        
        const updateData: any = { 
          slack_access_token: botToken,
          slack_team_id: teamId,
        };
        if (userToken) {
          updateData.slack_user_token = userToken;
        }

        await this.tenantModel.findByIdAndUpdate(
          new Types.ObjectId(tenantId),
          updateData,
          { new: true }
        );

        this.logger.log(`Slack connected for tenant: ${tenantId}`);

        // Register in tenant_applications collection
        const app = await this.applicationModel.findOne({ slug: 'slack' });
        if (app) {
          await this.tenantApplicationModel.updateOne(
            { tenant_id: new Types.ObjectId(tenantId), application_id: app._id },
            { 
              $set: { 
                status: TenantApplicationStatus.CONNECTED,
                display_name: 'Slack',
                is_connected: true,
                is_deleted: false,
                connected_at: new Date(),
                last_synced_at: new Date(),
                updatedAt: new Date(),
              },
              $setOnInsert: { createdAt: new Date() }
            },
            { upsert: true }
          );
          this.logger.log(`Dynamic registration: Slack added to tenant_applications for ${tenantId}`);
        }

        return result;
      } else {
        throw new Error(result.error);
      }
    } catch (e: any) {
      this.logger.error(`Slack OAuth callback failed: ${e.message}`);
      throw new BadRequestException('Failed to exchange authorization code for Slack token');
    }
  }

  async inviteUserOrNotify(tenantId: string, contractId: string, email: string, firstName: string, lastName: string): Promise<string | undefined> {
    this.logger.log(`[Slack] inviteUserOrNotify called for tenant ${tenantId}, email ${email}`);
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) {
      this.logger.error(`[Slack] Tenant ${tenantId} not found`);
      return undefined;
    }
    this.logger.log(`[Slack] Tenant found. BotToken=${!!tenant.slack_access_token}, UserToken=${!!tenant.slack_user_token}`);
    if (!tenant.slack_access_token) {
      this.logger.error(`[Slack] Cannot provision for tenant ${tenantId}: Missing token.`);
      return undefined;
    } 

    const client = new WebClient(tenant.slack_access_token);

    try {
      // --- PRIORITY 1: SCIM User Creation (Requires Enterprise Grid / SCIM enabled) ---
      this.logger.log(`[Slack] Attempting SCIM User Creation for ${email}`);
      const scimToken = tenant.slack_user_token || tenant.slack_access_token;
      
      try {
        const scimResponse = await fetch('https://api.slack.com/scim/v1/Users', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${scimToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            schemas: ["urn:scim:schemas:core:1.0"],
            userName: email,
            name: {
              givenName: firstName || 'Contractor',
              familyName: lastName || 'User'
            },
            emails: [
              {
                value: email,
                primary: true
              }
            ],
            active: true
          })
        });

        const scimData = await scimResponse.json().catch(() => ({}));

        if (scimResponse.ok) {
          this.logger.log(`[Slack] Successfully created user ${email} via SCIM API`);
          return scimData.id;
        } else {
          this.logger.warn(`[Slack] SCIM creation failed (${scimResponse.status}): ${JSON.stringify(scimData)}`);
        }
      } catch (scimErr: any) {
        this.logger.error(`[Slack] SCIM API request failed: ${scimErr.message}`);
      }

      // --- PRIORITY 2: Admin Invite Fallback ---
      this.logger.log(`[Slack] Attempting admin.users.invite for ${email}`);
      try {
        const channels = await client.conversations.list({ types: 'public_channel', limit: 1 });
        const fallbackChannelId = channels.channels?.[0]?.id;

        await (client.admin.users.invite as any)({
          team_id: tenant.slack_team_id || '',
          email: email,
          channel_ids: fallbackChannelId ? [fallbackChannelId] : [],
          custom_message: 'Welcome to the team!',
        });
        this.logger.log(`[Slack] Successfully invited ${email} via admin API`);
        // Invitation sent, but we don't have ID yet. We'll do a lookup in the next step.
      } catch (adminErr: any) {
        const adminErrorMsg = adminErr.data?.error || adminErr.message;
        this.logger.warn(`[Slack] admin.users.invite fallback failed: ${adminErrorMsg}`);
      }

      // --- ATTEMPT ID LOOKUP (If user already exists or was just invited) ---
      try {
        this.logger.log(`[Slack] Attempting to lookup user ID for ${email}...`);
        const lookup = await client.users.lookupByEmail({ email });
        if (lookup.ok && lookup.user?.id) {
          this.logger.log(`[Slack] Found User ID: ${lookup.user.id}`);
          return lookup.user.id;
        }
      } catch (lookupErr: any) {
        this.logger.warn(`[Slack] Lookup by email failed: ${lookupErr.data?.error || lookupErr.message}`);
      }

      // --- FINAL NOTIFICATION FALLBACK ---
      this.logger.log(`[Slack] Falling back to notification for ${email}`);
      await this.slackBotService.sendOnboardingNotification(tenantId, contractId, firstName, lastName, email);
      return undefined;

    } catch (e: any) {
      const errorMsg = e.data?.error || e.message;
      this.logger.error(`[Slack] Unexpected provisioning error for ${email}: ${errorMsg}`, e.data);
      throw e;
    }
  }

  async revokeUserOrNotify(tenantId: string, contractId: string | undefined, email: string, externalId?: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.slack_access_token) return;

    const client = new WebClient(tenant.slack_access_token);
    let slackUserId: string | undefined = externalId;

    if (!slackUserId) {
      try {
        const userLookup = await client.users.lookupByEmail({ email });
        if (userLookup.ok && userLookup.user?.id) {
           slackUserId = userLookup.user.id;
        }
      } catch (e: any) {
        const errorMsg = e.data?.error || e.message;
        if (errorMsg === 'users_not_found') {
          this.logger.warn(`[Slack] User ${email} not found via email lookup. Skipping API removal.`);
        } else {
          this.logger.error(`[Slack] Revocation lookup failed: ${errorMsg}`);
        }
      }
    }

    if (slackUserId) {
      let scimSuccess = false;
      
      // --- PRIORITY 1: SCIM User Deactivation ---
      const scimToken = tenant.slack_user_token || tenant.slack_access_token;
      try {
        const scimDeleteResponse = await fetch(`https://api.slack.com/scim/v1/Users/${slackUserId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${scimToken}`,
          }
        });

        if (scimDeleteResponse.ok) {
          this.logger.log(`[Slack] Successfully deactivated user ${email} via SCIM API`);
          scimSuccess = true;
          return;
        } else {
          const scimData = await scimDeleteResponse.json().catch(() => ({}));
          this.logger.warn(`[Slack] SCIM deactivation failed for ${email} (${scimDeleteResponse.status}): ${JSON.stringify(scimData)}`);
        }
      } catch (scimErr: any) {
        this.logger.error(`[Slack] SCIM Deactivation failed for ${email}: ${scimErr.message}`);
      }

      // --- PRIORITY 2: Admin API Fallback ---
      if (!scimSuccess) {
        try {
          await client.admin.users.remove({
            team_id: tenant.slack_team_id || '',
            user_id: slackUserId
          });
          this.logger.log(`[Slack] Successfully removed user ${email} via admin API`);
          return;
        } catch (adminErr: any) {
          this.logger.warn(`[Slack] admin.users.remove failed for ${email}: ${adminErr.data?.error || adminErr.message}`);
        }
      }
    }

    // --- PRIORITY 3: Manual Notification via Bot ---
    this.logger.log(`[Slack] Falling back to revocation notification for ${email}`);
    await this.slackBotService.sendRevocationNotification(tenantId, contractId, email);
  }
}

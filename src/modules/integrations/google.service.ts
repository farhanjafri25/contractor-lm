import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from '../../schemas/tenant.schema';
import { Application, ApplicationDocument } from '../../schemas/application.schema';
import { TenantApplication, TenantApplicationDocument, TenantApplicationStatus } from '../../schemas/tenant-application.schema';
import { google } from 'googleapis';

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private oauth2Client;

  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(Application.name) private applicationModel: Model<ApplicationDocument>,
    @InjectModel(TenantApplication.name) private tenantApplicationModel: Model<TenantApplicationDocument>,
  ) {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  getAuthorizationUrl(tenantId: string): string {
    const scopes = [
      'https://www.googleapis.com/auth/admin.directory.user'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline', 
      prompt: 'consent', 
      scope: scopes,
      state: tenantId // Attach tenantId inside state payload to securely sync when the redirect catches it
    });
  }

  async handleCallback(code: string, tenantId: string) {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);
      
      if (tokens.refresh_token) {
        await this.tenantModel.findByIdAndUpdate(
          new Types.ObjectId(tenantId),
          { google_workspace_refresh_token: tokens.refresh_token },
          { new: true }
        );
        this.logger.log(`Google Workspace connected for tenant: ${tenantId}`);

        // Register in tenant_applications collection
        const app = await this.applicationModel.findOne({ slug: 'google-workspace' });
        if (app) {
          await this.tenantApplicationModel.updateOne(
            { tenant_id: new Types.ObjectId(tenantId), application_id: app._id },
            { 
              $set: { 
                status: TenantApplicationStatus.CONNECTED,
                display_name: 'Google Workspace',
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
          this.logger.log(`Dynamic registration: Google Workspace added to tenant_applications for ${tenantId}`);
        }
      } else {
         this.logger.warn(`No explicit refresh token returned for tenant: ${tenantId}`);
      }
      return tokens;
    } catch (e) {
      this.logger.error(`OAuth callback failed: ${e.message}`);
      throw new BadRequestException('Failed to exchange authorization code for Google token');
    }
  }

  async provisionUser(tenantId: string, email: string, firstName: string, lastName: string) {
    this.logger.log(`[Google] provisionUser called: tenant=${tenantId}, email=${email}, name="${firstName} ${lastName}"`);
    
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) {
      this.logger.warn(`[Google] Tenant ${tenantId} not found in DB — cannot provision ${email}`);
      return null;
    }
    if (!tenant.google_workspace_refresh_token) {
      this.logger.warn(`[Google] Tenant ${tenantId} has no google_workspace_refresh_token — cannot provision ${email}`);
      return null;
    }
    this.logger.log(`[Google] Tenant found, refresh token present. Setting up OAuth2 client...`);

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });
    const internalPassword = Math.random().toString(36).slice(-10) + 'A1!';

    this.logger.log(`[Google] Calling directory.users.insert for ${email}...`);
    try {
      const res = await directory.users.insert({
        requestBody: {
          primaryEmail: email,
          name: {
            givenName: firstName,
            familyName: lastName
          },
          password: internalPassword,
          changePasswordAtNextLogin: true, 
        }
      });
      this.logger.log(`[Google] ✅ User provisioned successfully: primaryEmail=${res.data.primaryEmail}, id=${res.data.id}`);
      return res.data;
    } catch (e) {
      if (e.code === 409 || e.message?.includes('already exists')) {
        this.logger.log(`[Google] ℹ️ User ${email} already exists. Fetching existing user details...`);
        try {
          const existingUser = await directory.users.get({ userKey: email });
          this.logger.log(`[Google] ✅ Existing user found: primaryEmail=${existingUser.data.primaryEmail}, id=${existingUser.data.id}`);
          return existingUser.data;
        } catch (getErr) {
          this.logger.error(`[Google] ❌ Failed to fetch existing user ${email}: ${getErr.message}`);
          throw e; // Rethrow original conflict error if get fails
        }
      }
      this.logger.error(`[Google] ❌ Provisioning error for ${email}: ${e.message} (code=${e.code})`);
      throw e;
    }
  }

  async suspendUser(tenantId: string, email: string, externalId?: string) {
    this.logger.log(`[Google] suspendUser called: tenant=${tenantId}, email=${email}, externalId=${externalId}`);
    
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.google_workspace_refresh_token) {
      this.logger.warn(`[Google] Tenant ${tenantId} missing or has no refresh token — skipping suspension for ${email}`);
      return null;
    }
    this.logger.log(`[Google] ACTION: Suspend User | Target: ${externalId || email} | Tenant: ${tenantId}`);
    this.logger.log(`[Google] Tenant found, refresh token present. Proceeding with suspension...`);

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });

    try {
      const res = await directory.users.update({
        userKey: externalId || email,
        requestBody: {
          suspended: true,
        }
      });
      this.logger.log(`[Google] ✅ User ${email} suspended successfully`);
      return res.data;
    } catch (e) {
      if (e.code === 404 || e.message?.includes('Resource Not Found')) {
        this.logger.warn(`[Google] User ${email} not found in directory — may have been already removed or never provisioned. Skipping suspension.`);
        return null;
      }
      this.logger.error(`[Google] ❌ Suspension error for ${email}: ${e.message} (code=${e.code})`);
      throw e;
    }
  }

  async deleteUser(tenantId: string, email: string, externalId?: string) {
    this.logger.log(`[Google] deleteUser called: tenant=${tenantId}, email=${email}, externalId=${externalId}`);
    
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.google_workspace_refresh_token) {
      this.logger.warn(`[Google] Tenant ${tenantId} missing or has no refresh token — skipping deletion for ${email}`);
      return null;
    }
    this.logger.log(`[Google] ACTION: Delete User | Target: ${externalId || email} | Tenant: ${tenantId}`);
    this.logger.log(`[Google] Tenant found, refresh token present. Proceeding with deletion...`);

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });

    try {
      const res = await directory.users.delete({
        userKey: externalId || email,
      });
      this.logger.log(`[Google] ✅ User ${email} deleted successfully`);
      return res.data;
    } catch (e) {
      if (e.code === 404 || e.message?.includes('Resource Not Found')) {
        this.logger.warn(`[Google] User ${email} not found in directory — may have been already deleted or never provisioned. Skipping deletion.`);
        return null;
      }
      this.logger.error(`[Google] ❌ Deletion error for ${email}: ${e.message} (code=${e.code})`);
      throw e;
    }
  }
}

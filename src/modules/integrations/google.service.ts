import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from '../../schemas/tenant.schema';
import { google } from 'googleapis';

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private oauth2Client;

  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>
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
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.google_workspace_refresh_token) {
      this.logger.warn(`Cannot provision ${email}: Tenant ${tenantId} holds no Google refresh token.`);
      return null;
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });
    const internalPassword = Math.random().toString(36).slice(-10) + 'A1!';

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
      return res.data;
    } catch (e) {
      this.logger.error(`Provisioning error on Google Directory API: ${e.message}`);
      throw e;
    }
  }

  async suspendUser(tenantId: string, email: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.google_workspace_refresh_token) {
      return null;
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });

    try {
      const res = await directory.users.update({
        userKey: email,
        requestBody: {
          suspended: true,
        }
      });
      return res.data;
    } catch (e) {
      this.logger.error(`Suspension error on Google Directory API: ${e.message}`);
      throw e;
    }
  }

  async deleteUser(tenantId: string, email: string) {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant || !tenant.google_workspace_refresh_token) {
      return null;
    }

    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    client.setCredentials({ refresh_token: tenant.google_workspace_refresh_token });

    const directory = google.admin({ version: 'directory_v1', auth: client });

    try {
      const res = await directory.users.delete({
        userKey: email,
      });
      return res.data;
    } catch (e) {
      this.logger.error(`Deletion error on Google Directory API: ${e.message}`);
      throw e;
    }
  }
}

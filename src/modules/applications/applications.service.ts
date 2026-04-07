import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TenantApplication, TenantApplicationDocument } from '../../schemas/tenant-application.schema';
import { Application, ApplicationDocument } from '../../schemas/application.schema';

@Injectable()
export class ApplicationsService implements OnModuleInit {
  private readonly logger = new Logger(ApplicationsService.name);
  
  constructor(
    @InjectModel(TenantApplication.name)
    private tenantApplicationModel: Model<TenantApplicationDocument>,
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
  ) {}

  async onModuleInit() {
    await this.bootstrapApplications();
  }

  /**
   * Automatically populates the global applications catalog if it is empty.
   * This is a self-healing mechanism for new environments (like Render).
   */
  async bootstrapApplications() {
    try {
      const allowedSlugs = ['google-workspace', 'slack'];
      
      // 1. Ensure supported apps exist
      const apps = [
        { 
          name: 'Google Workspace', 
          slug: 'google-workspace', 
          auth_type: 'oauth2', 
          image_url: 'https://img.icons8.com/color/48/google-logo.png',
          scopes: ['https://www.googleapis.com/auth/admin.directory.user', 'https://www.googleapis.com/auth/admin.directory.group'],
          is_active: true,
        },
        { 
          name: 'Slack', 
          slug: 'slack', 
          auth_type: 'oauth2', 
          image_url: 'https://img.icons8.com/color/48/slack-new.png',
          scopes: ['admin', 'users:read', 'users:read.email', 'chat:write'],
          is_active: true,
        },
      ];

      for (const app of apps) {
        await this.applicationModel.updateOne(
          { slug: app.slug },
          { 
            $set: { 
              ...app,
              updatedAt: new Date() 
            },
            $setOnInsert: { createdAt: new Date(), version_id: 'v1' }
          },
          { upsert: true }
        );
      }

      // 2. Deactivate any apps NOT in our allowed list
      const result = await this.applicationModel.updateMany(
        { slug: { $nin: allowedSlugs } },
        { $set: { is_active: false } }
      );
      
      if (result.modifiedCount > 0) {
        this.logger.log(`Deactivated ${result.modifiedCount} unsupported applications.`);
      }

      this.logger.log('✅ Global application catalog synced (Google & Slack only).');
    } catch (e) {
      this.logger.error(`Failed to bootstrap applications: ${e.message}`);
    }
  }

  /**
   * Find all active applications connected to a tenant.
   * Populates the global application metadata (name, slug, icons).
   */
  async findAll(tenantId: string) {
    return this.tenantApplicationModel
      .find({
        tenant_id: new Types.ObjectId(tenantId),
        is_deleted: false,
      })
      .populate({
        path: 'application_id',
        match: { is_active: true }, // Ensure we only return active apps
        select: 'name slug auth_type image_url is_active',
      })
      .sort({ createdAt: -1 })
      .lean();
  }
}

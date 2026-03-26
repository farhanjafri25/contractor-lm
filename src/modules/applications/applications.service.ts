import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { TenantApplication, TenantApplicationDocument } from '../../schemas/tenant-application.schema';
import { Application, ApplicationDocument } from '../../schemas/application.schema';

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectModel(TenantApplication.name)
    private tenantApplicationModel: Model<TenantApplicationDocument>,
    @InjectModel(Application.name)
    private applicationModel: Model<ApplicationDocument>,
  ) {}

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
        select: 'name slug auth_type image_url',
      })
      .sort({ createdAt: -1 })
      .lean();
  }
}

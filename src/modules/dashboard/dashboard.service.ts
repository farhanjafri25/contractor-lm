import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ContractorContract } from '../../schemas/contractor-contract.schema';
import type { ContractorContractDocument } from '../../schemas/contractor-contract.schema';
import { ContractStatus } from '../../schemas/contractor-contract.schema';
import { ContractorAccess } from '../../schemas/contractor-access.schema';
import type { ContractorAccessDocument } from '../../schemas/contractor-access.schema';
import { ProvisioningStatus } from '../../schemas/contractor-access.schema';
import { ContractorIdentity } from '../../schemas/contractor-identity.schema';
import type { ContractorIdentityDocument } from '../../schemas/contractor-identity.schema';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

const ACTIVE_STATUSES = [ContractStatus.ACTIVE, ContractStatus.EXTENDED];

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(ContractorContract.name)
    private contractModel: Model<ContractorContractDocument>,

    @InjectModel(ContractorAccess.name)
    private accessModel: Model<ContractorAccessDocument>,

    @InjectModel(ContractorIdentity.name)
    private identityModel: Model<ContractorIdentityDocument>,
  ) { }

  // ─────────────────────────────────────────────────────────
  // MAIN SUMMARY — GET /dashboard/summary
  // All key metrics in one round-trip for the header cards
  // ─────────────────────────────────────────────────────────
  async getSummary(tenantId: string, query: DashboardQueryDto) {
    const tenantOid = new Types.ObjectId(tenantId);
    const now = new Date();
    const expiryHorizon = new Date(now);
    expiryHorizon.setDate(now.getDate() + (query.expiring_within_days ?? 30));

    const [
      activeCount,
      suspendedCount,
      expiringSoonCount,
      overdueAccessCount,
      failedRevocationCount,
      departmentBreakdown,
    ] = await Promise.all([
      // Active + extended contracts
      this.contractModel.countDocuments({
        tenant_id: tenantOid,
        status: { $in: ACTIVE_STATUSES },
      }),

      // Suspended contracts
      this.contractModel.countDocuments({
        tenant_id: tenantOid,
        status: ContractStatus.SUSPENDED,
      }),

      // Expiring within window
      this.contractModel.countDocuments({
        tenant_id: tenantOid,
        status: { $in: ACTIVE_STATUSES },
        end_date: { $gte: now, $lte: expiryHorizon },
      }),

      // Contracts that already expired but still have active access (overdue)
      this._countOverdueAccess(tenantOid, now),

      // Access records with failed revocation attempts
      this.accessModel.countDocuments({
        tenant_id: tenantOid,
        provisioning_status: ProvisioningStatus.FAILED,
      }),

      // Active contractors by department (top 8)
      this._getDepartmentBreakdown(tenantOid),
    ]);

    return {
      active_contractors: activeCount,
      suspended_contractors: suspendedCount,
      expiring_soon: expiringSoonCount,
      expiring_within_days: query.expiring_within_days ?? 30,
      overdue_access: overdueAccessCount,
      failed_revocations: failedRevocationCount,
      by_department: departmentBreakdown,
      generated_at: now,
    };
  }

  // ─────────────────────────────────────────────────────────
  // EXPIRING SOON — GET /dashboard/expiring
  // Full paginated list for the "Expiring Soon" table
  // ─────────────────────────────────────────────────────────
  async getExpiring(tenantId: string, query: DashboardQueryDto) {
    const tenantOid = new Types.ObjectId(tenantId);
    const now = new Date();
    const horizon = new Date(now);
    horizon.setDate(now.getDate() + (query.expiring_within_days ?? 30));

    const limit = query.limit ?? 20;
    const skip = ((query.page ?? 1) - 1) * limit;

    const [contracts, total] = await Promise.all([
      this.contractModel
        .find({
          tenant_id: tenantOid,
          status: { $in: ACTIVE_STATUSES },
          end_date: { $gte: now, $lte: horizon },
        })
        .sort({ end_date: 1 }) // soonest first
        .skip(skip)
        .limit(limit)
        .populate('contractor_id', 'name email department job_title')
        .populate('sponsor_id', 'email role')
        .lean(),

      this.contractModel.countDocuments({
        tenant_id: tenantOid,
        status: { $in: ACTIVE_STATUSES },
        end_date: { $gte: now, $lte: horizon },
      }),
    ]);

    return {
      data: contracts.map((c) => ({
        ...c,
        days_remaining: Math.ceil(
          (new Date(c.end_date).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      })),
      total,
      page: query.page ?? 1,
      limit,
    };
  }

  // ─────────────────────────────────────────────────────────
  // OVERDUE — GET /dashboard/overdue
  // Expired contracts that still have un-revoked active access
  // ─────────────────────────────────────────────────────────
  async getOverdue(tenantId: string, query: DashboardQueryDto) {
    const tenantOid = new Types.ObjectId(tenantId);
    const now = new Date();
    const limit = query.limit ?? 20;
    const skip = ((query.page ?? 1) - 1) * limit;

    // Find expired contracts for this tenant
    const expiredContracts = await this.contractModel
      .find({
        tenant_id: tenantOid,
        status: { $in: [ContractStatus.EXPIRED, ContractStatus.TERMINATED] },
      })
      .select('_id contractor_id end_date status')
      .lean();

    if (!expiredContracts.length) {
      return { data: [], total: 0, page: query.page ?? 1, limit };
    }

    const expiredIds = expiredContracts.map((c) => c._id);

    // Find active access records that belong to expired contracts
    const [overdueAccess, total] = await Promise.all([
      this.accessModel
        .find({
          tenant_id: tenantOid,
          contract_id: { $in: expiredIds },
          provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contractor_id', 'name email department')
        .populate('contract_id', 'end_date status')
        .populate('tenant_application_id', 'application_id')
        .lean(),

      this.accessModel.countDocuments({
        tenant_id: tenantOid,
        contract_id: { $in: expiredIds },
        provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
      }),
    ]);

    return {
      data: overdueAccess.map((a) => ({
        ...a,
        days_overdue: Math.ceil(
          (now.getTime() - new Date((a.contract_id as any).end_date).getTime()) /
          (1000 * 60 * 60 * 24),
        ),
      })),
      total,
      page: query.page ?? 1,
      limit,
    };
  }

  // ─────────────────────────────────────────────────────────
  // AT-RISK — GET /dashboard/at-risk
  // Suspended + failed-revocation contractors — things needing attention
  // ─────────────────────────────────────────────────────────
  async getAtRisk(tenantId: string, query: DashboardQueryDto) {
    const tenantOid = new Types.ObjectId(tenantId);
    const limit = query.limit ?? 20;
    const skip = ((query.page ?? 1) - 1) * limit;

    const [suspended, failedRevocations] = await Promise.all([
      this.contractModel
        .find({ tenant_id: tenantOid, status: ContractStatus.SUSPENDED })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contractor_id', 'name email department')
        .populate('sponsor_id', 'email')
        .lean(),

      this.accessModel
        .find({
          tenant_id: tenantOid,
          provisioning_status: ProvisioningStatus.FAILED,
          revocation_attempts: { $gte: 1 },
        })
        .sort({ last_attempt_at: -1 })
        .limit(10)
        .populate('contractor_id', 'name email')
        .populate('tenant_application_id', 'application_id')
        .lean(),
    ]);

    return {
      suspended_contracts: {
        data: suspended,
        total: await this.contractModel.countDocuments({
          tenant_id: tenantOid,
          status: ContractStatus.SUSPENDED,
        }),
      },
      failed_revocations: {
        data: failedRevocations,
        total: await this.accessModel.countDocuments({
          tenant_id: tenantOid,
          provisioning_status: ProvisioningStatus.FAILED,
        }),
      },
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL HELPERS
  // ─────────────────────────────────────────────────────────

  private async _countOverdueAccess(tenantOid: Types.ObjectId, now: Date): Promise<number> {
    const expiredContracts = await this.contractModel
      .find({
        tenant_id: tenantOid,
        status: { $in: [ContractStatus.EXPIRED, ContractStatus.TERMINATED] },
      })
      .select('_id')
      .lean();

    if (!expiredContracts.length) return 0;

    return this.accessModel.countDocuments({
      tenant_id: tenantOid,
      contract_id: { $in: expiredContracts.map((c) => c._id) },
      provisioning_status: { $in: [ProvisioningStatus.ACTIVE, ProvisioningStatus.PENDING] },
    });
  }

  private async _getDepartmentBreakdown(
    tenantOid: Types.ObjectId,
  ): Promise<Array<{ department: string; count: number }>> {
    // Aggregate active contractor identities by department
    const result = await this.identityModel.aggregate([
      // Find identities with an active contract in this tenant
      {
        $lookup: {
          from: 'contractor_contracts',
          let: { identityId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$contractor_id', '$$identityId'] },
                tenant_id: tenantOid,
                status: { $in: ACTIVE_STATUSES },
              },
            },
            { $limit: 1 },
          ],
          as: 'activeContract',
        },
      },
      { $match: { activeContract: { $ne: [] }, tenant_id: tenantOid } },
      // Group by department
      {
        $group: {
          _id: { $ifNull: ['$department', 'Unassigned'] },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 8 },
      { $project: { _id: 0, department: '$_id', count: 1 } },
    ]);

    return result;
  }
}

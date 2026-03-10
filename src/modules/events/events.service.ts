import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LifecycleEvent } from '../../schemas/lifecycle-event.schema';
import type { LifecycleEventDocument } from '../../schemas/lifecycle-event.schema';
import { ListEventsDto } from './dto/list-events.dto';

// Maps UI-friendly category names to the dot-notation event_type prefix
const CATEGORY_PREFIXES: Record<string, string> = {
  contractor: 'contractor.',
  access: 'access.',
  contract: 'contract.',
  sponsor: 'sponsor.',
  extension: 'extension.',
  directory: 'directory_sync.',
};

@Injectable()
export class EventsService {
  constructor(
    @InjectModel(LifecycleEvent.name)
    private eventModel: Model<LifecycleEventDocument>,
  ) { }

  // ─────────────────────────────────────────────────────────
  // LIST — GET /events
  // Main audit log query — filterable and paginated
  // ─────────────────────────────────────────────────────────
  async findAll(tenantId: string, query: ListEventsDto) {
    const filter = this._buildFilter(tenantId, query);
    const limit = query.limit ?? 25;
    const skip = ((query.page ?? 1) - 1) * limit;

    const [events, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ created_at: -1 })      // newest first — audit log convention
        .skip(skip)
        .limit(limit)
        .populate('contractor_id', 'name email department')
        .populate('contract_id', 'start_date end_date status')
        .populate('actor_id', 'email role')
        .lean(),
      this.eventModel.countDocuments(filter),
    ]);

    return {
      data: events,
      total,
      page: query.page ?? 1,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─────────────────────────────────────────────────────────
  // GET ONE — GET /events/:id
  // ─────────────────────────────────────────────────────────
  async findOne(eventId: string, tenantId: string) {
    const event = await this.eventModel
      .findOne({
        _id: new Types.ObjectId(eventId),
        tenant_id: new Types.ObjectId(tenantId),
      })
      .populate('contractor_id', 'name email department job_title')
      .populate('contract_id', 'start_date end_date status extension_count')
      .populate('actor_id', 'email role')
      .populate('access_id', 'tenant_application_id provisioning_status')
      .lean();

    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  // ─────────────────────────────────────────────────────────
  // CONTRACTOR TIMELINE — GET /events/contractor/:contractorId
  // Full chronological audit trail for a single contractor
  // ─────────────────────────────────────────────────────────
  async getContractorTimeline(contractorId: string, tenantId: string, query: ListEventsDto) {
    const filter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
      contractor_id: new Types.ObjectId(contractorId),
    };
    if (query.event_type) filter.event_type = query.event_type;
    if (query.contract_id) filter.contract_id = new Types.ObjectId(query.contract_id);

    const limit = query.limit ?? 50;
    const skip = ((query.page ?? 1) - 1) * limit;

    const [events, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .populate('contract_id', 'start_date end_date status')
        .populate('actor_id', 'email role')
        .lean(),
      this.eventModel.countDocuments(filter),
    ]);

    return {
      data: events,
      total,
      page: query.page ?? 1,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─────────────────────────────────────────────────────────
  // STATS — GET /events/stats
  // Event counts grouped by type for trend analysis/charting
  // ─────────────────────────────────────────────────────────
  async getStats(tenantId: string, query: ListEventsDto) {
    const tenantOid = new Types.ObjectId(tenantId);

    // Build optional date range match for the aggregation
    const dateMatch: Record<string, any> = {};
    if (query.from) dateMatch.$gte = new Date(query.from);
    if (query.to) dateMatch.$lte = new Date(query.to);

    const matchStage: Record<string, any> = { tenant_id: tenantOid };
    if (Object.keys(dateMatch).length) matchStage.created_at = dateMatch;
    if (query.category && CATEGORY_PREFIXES[query.category]) {
      matchStage.event_type = { $regex: `^${CATEGORY_PREFIXES[query.category]}` };
    }

    const [byType, byDay] = await Promise.all([
      // Counts per event_type
      this.eventModel.aggregate([
        { $match: matchStage },
        { $group: { _id: '$event_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { _id: 0, event_type: '$_id', count: 1 } },
      ]),

      // Daily event volume for the last 30 days (for a sparkline chart)
      this.eventModel.aggregate([
        {
          $match: {
            tenant_id: tenantOid,
            created_at: {
              $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$created_at' },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', count: 1 } },
      ]),
    ]);

    return {
      by_event_type: byType,
      daily_volume_last_30d: byDay,
      generated_at: new Date(),
    };
  }

  // ─────────────────────────────────────────────────────────
  // INTERNAL — filter builder
  // ─────────────────────────────────────────────────────────
  private _buildFilter(
    tenantId: string,
    query: ListEventsDto,
  ): Record<string, any> {
    const filter: Record<string, any> = {
      tenant_id: new Types.ObjectId(tenantId),
    };

    if (query.event_type) {
      filter.event_type = query.event_type;
    } else if (query.category && CATEGORY_PREFIXES[query.category]) {
      // prefix-match: e.g. category=contract → matches contract.*
      filter.event_type = { $regex: `^${CATEGORY_PREFIXES[query.category]}` };
    }

    if (query.actor_type) filter.actor_type = query.actor_type;
    if (query.contractor_id) filter.contractor_id = new Types.ObjectId(query.contractor_id);
    if (query.contract_id) filter.contract_id = new Types.ObjectId(query.contract_id);
    if (query.actor_id) filter.actor_id = new Types.ObjectId(query.actor_id);

    // Date range on the immutable created_at field
    if (query.from || query.to) {
      filter.created_at = {};
      if (query.from) filter.created_at.$gte = new Date(query.from);
      if (query.to) filter.created_at.$lte = new Date(query.to);
    }

    return filter;
  }
}

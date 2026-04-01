import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as Papa from 'papaparse';
import { ContractorIdentity } from '../schemas/contractor-identity.schema';
import type { ContractorIdentityDocument } from '../schemas/contractor-identity.schema';
import { ContractorContract } from '../schemas/contractor-contract.schema';
import type { ContractorContractDocument } from '../schemas/contractor-contract.schema';
import { ContractStatus } from '../schemas/contractor-contract.schema';
import { LifecycleEvent } from '../schemas/lifecycle-event.schema';
import type { LifecycleEventDocument } from '../schemas/lifecycle-event.schema';
import { EventType, ActorType } from '../schemas/lifecycle-event.schema';

export interface ImportJob {
    csvData: string;
    fieldMapping: Record<string, string>;
    tenantId: string;
    userId: string;
}

const REQUIRED_FIELDS = ['name', 'email', 'end_date'];

@Processor('import', {
    stalledInterval: 300000,
    drainDelay: 10000,
    skipStalledCheck: true,
})
export class ImportProcessor extends WorkerHost {
    constructor(
        @InjectModel(ContractorIdentity.name)
        private identityModel: Model<ContractorIdentityDocument>,

        @InjectModel(ContractorContract.name)
        private contractModel: Model<ContractorContractDocument>,

        @InjectModel(LifecycleEvent.name)
        private eventModel: Model<LifecycleEventDocument>,
    ) { 
        super();
    }

    async process(job: Job<ImportJob>) {
        const { csvData, fieldMapping, tenantId, userId } = job.data;
        const tenantOid = new Types.ObjectId(tenantId);
        const userOid = new Types.ObjectId(userId);

        const parsed = Papa.parse<Record<string, string>>(csvData, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
        });

        const rows = parsed.data;
        let successCount = 0;
        const failures: Array<{ row: number; email: string; error: string }> = [];

        for (let i = 0; i < rows.length; i++) {
            const rawRow = rows[i];
            const rowNumber = i + 2;

            try {
                const mapped = this._applyMapping(rawRow, fieldMapping);

                for (const field of REQUIRED_FIELDS) {
                    if (!mapped[field]) throw new Error(`Missing required field: ${field}`);
                }

                const email = (mapped.email as string).toLowerCase().trim();
                const endDate = new Date(mapped.end_date as string);
                if (isNaN(endDate.getTime())) {
                    throw new Error(`Invalid end_date: ${mapped.end_date}`);
                }

                let identity = await this.identityModel.findOne({ tenant_id: tenantOid, email });
                if (!identity) {
                    identity = await this.identityModel.create({
                        tenant_id: tenantOid,
                        name: (mapped.name as string).trim(),
                        email,
                        job_title: (mapped.job_title as string) ?? null,
                        department: (mapped.department as string) ?? null,
                        phone: (mapped.phone as string) ?? null,
                        location: (mapped.location as string) ?? null,
                        notes: (mapped.notes as string) ?? null,
                        created_by: userOid,
                    });
                }

                const activeContract = await this.contractModel.findOne({
                    contractor_id: identity._id,
                    status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
                });
                if (activeContract) {
                    throw new Error(`Contractor ${email} already has an active contract`);
                }

                await this.contractModel.create({
                    contractor_id: identity._id,
                    tenant_id: tenantOid,
                    sponsor_id: mapped.sponsor_id ? new Types.ObjectId(mapped.sponsor_id as string) : null,
                    start_date: new Date(),
                    end_date: endDate,
                    original_end_date: endDate,
                    status: ContractStatus.ACTIVE,
                    create_google_account: false,
                    extension_count: 0,
                    is_rehire: false,
                    created_by: userOid,
                });

                successCount++;
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                failures.push({ row: rowNumber, email: rawRow?.email ?? '', error: msg });
            }
        }

        await this.eventModel.create({
            tenant_id: tenantOid,
            contractor_id: new Types.ObjectId(),
            contract_id: new Types.ObjectId(),
            event_type: EventType.CONTRACTOR_BULK_IMPORTED,
            actor_type: ActorType.USER,
            actor_id: userOid,
            metadata: { row_count: rows.length, success_count: successCount, failures },
        });

        return { success_count: successCount, failures };
    }

    private _applyMapping(
        row: Record<string, string>,
        mapping: Record<string, string>,
    ): Record<string, string> {
        if (!Object.keys(mapping).length) return row;
        const result: Record<string, string> = {};
        for (const [csvCol, schemaField] of Object.entries(mapping)) {
            if (row[csvCol] !== undefined) result[schemaField] = row[csvCol];
        }
        for (const [col, val] of Object.entries(row)) {
            if (!mapping[col] && !result[col]) result[col] = val;
        }
        return result;
    }
}

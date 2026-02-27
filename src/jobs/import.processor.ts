import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as Papa from 'papaparse';
import {
    ContractorIdentity,
    ContractorIdentityDocument,
} from '../schemas/contractor-identity.schema';
import {
    ContractorContract,
    ContractorContractDocument,
    ContractStatus,
} from '../schemas/contractor-contract.schema';
import {
    LifecycleEvent,
    LifecycleEventDocument,
    EventType,
    ActorType,
} from '../schemas/lifecycle-event.schema';

export interface ImportJob {
    csvData: string;
    fieldMapping: Record<string, string>;
    // e.g. { "Full Name": "name", "End Date": "end_date", "Sponsor Email": "sponsor_id" }
    tenantId: string;
    userId: string;
}

// Minimum required fields that must map from CSV
const REQUIRED_FIELDS = ['name', 'email', 'end_date'];

@Processor('import')
export class ImportProcessor {
    constructor(
        @InjectModel(ContractorIdentity.name)
        private identityModel: Model<ContractorIdentityDocument>,

        @InjectModel(ContractorContract.name)
        private contractModel: Model<ContractorContractDocument>,

        @InjectModel(LifecycleEvent.name)
        private eventModel: Model<LifecycleEventDocument>,
    ) { }

    @Process('process-csv')
    async handleImport(job: Job<ImportJob>) {
        const { csvData, fieldMapping, tenantId, userId } = job.data;
        const tenantOid = new Types.ObjectId(tenantId);
        const userOid = new Types.ObjectId(userId);

        // Parse CSV
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
            const rowNumber = i + 2; // 1-indexed with header offset

            try {
                // Apply field mapping: translate CSV column names to schema fields
                const mapped = this._applyMapping(rawRow, fieldMapping);

                // Validate required fields
                for (const field of REQUIRED_FIELDS) {
                    if (!mapped[field]) {
                        throw new Error(`Missing required field: ${field}`);
                    }
                }

                const email = (mapped.email as string).toLowerCase().trim();
                const endDate = new Date(mapped.end_date as string);

                if (isNaN(endDate.getTime())) {
                    throw new Error(`Invalid end_date: ${mapped.end_date}`);
                }

                // Upsert identity — if contractor already exists, skip recreation
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

                // Skip if already has an active contract
                const activeContract = await this.contractModel.findOne({
                    contractor_id: identity._id,
                    status: { $in: [ContractStatus.ACTIVE, ContractStatus.EXTENDED] },
                });
                if (activeContract) {
                    throw new Error(`Contractor ${email} already has an active contract`);
                }

                // end_date defaults to 90 days if missing; start_date = today
                const startDate = new Date();
                await this.contractModel.create({
                    contractor_id: identity._id,
                    tenant_id: tenantOid,
                    sponsor_id: mapped.sponsor_id ? new Types.ObjectId(mapped.sponsor_id as string) : null,
                    start_date: startDate,
                    end_date: endDate,
                    original_end_date: endDate,
                    status: ContractStatus.ACTIVE,
                    create_google_account: false,
                    extension_count: 0,
                    is_rehire: false,
                    created_by: userOid,
                });

                successCount++;
            } catch (err) {
                failures.push({
                    row: rowNumber,
                    email: rows[i]?.email ?? rows[i]?.[Object.keys(fieldMapping).find((k) => fieldMapping[k] === 'email') ?? 'email'] ?? '',
                    error: err.message,
                });
            }
        }

        // Log the bulk import event
        await this.eventModel.create({
            tenant_id: tenantOid,
            contractor_id: new Types.ObjectId(), // system event, no single contractor
            contract_id: new Types.ObjectId(),   // placeholder
            event_type: EventType.CONTRACTOR_BULK_IMPORTED,
            actor_type: ActorType.USER,
            actor_id: userOid,
            metadata: {
                row_count: rows.length,
                success_count: successCount,
                failures,
            },
        });

        console.log(`[ImportProcessor] Done — ${successCount}/${rows.length} rows imported`);
        return { success_count: successCount, failures };
    }

    /**
     * Translates raw CSV row keys using field_mapping.
     * Falls through with original key if no mapping is provided.
     * e.g. { "Full Name": "name" } → row["Full Name"] becomes mapped["name"]
     */
    private _applyMapping(
        row: Record<string, string>,
        mapping: Record<string, string>,
    ): Record<string, string> {
        if (!Object.keys(mapping).length) return row; // no mapping = use raw headers as-is

        const result: Record<string, string> = {};
        for (const [csvCol, schemaField] of Object.entries(mapping)) {
            if (row[csvCol] !== undefined) {
                result[schemaField] = row[csvCol];
            }
        }
        // Fall through any unmapped columns with their original names
        for (const [col, val] of Object.entries(row)) {
            if (!mapping[col] && !result[col]) result[col] = val;
        }
        return result;
    }
}

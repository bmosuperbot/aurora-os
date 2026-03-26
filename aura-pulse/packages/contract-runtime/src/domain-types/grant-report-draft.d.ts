import type { ContractTypeDefinition } from '../runtime/type-registry.js';

export interface GrantReportDraftContext {
    funder_name: string;
    grant_id: string;
    report_period: string;
    deadline: string;
    draft_path: string;
    data_sources: string[];
}

export const grantReportDraftType: ContractTypeDefinition;

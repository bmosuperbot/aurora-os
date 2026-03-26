/**
 * @import { BaseContract } from '../../src/types/base-contract.js'
 * @import { OfferReceivedContext } from '../../src/domain-types/offer-received.js'
 * @import { GrantReportDraftContext } from '../../src/domain-types/grant-report-draft.js'
 */

import { randomUUID } from 'node:crypto'

/**
 * @param {Partial<BaseContract>} [overrides]
 * @returns {BaseContract}
 */
export function makeContract(overrides = {}) {
    return /** @type {BaseContract} */ ({
        id: `contract-${randomUUID()}`,
        version: '1.0',
        type: 'offer-received',
        status: 'created',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        participants: {
            writer: { id: 'agent-primary', type: 'agent' },
            resolver: { id: 'owner', type: 'human' },
        },
        intent: {
            goal: 'Get owner decision on buyer offer',
            trigger: 'Buyer submitted offer on Poshmark listing',
            context: makeOfferContext(),
        },
        ...overrides,
    })
}

/**
 * @param {Partial<OfferReceivedContext>} [overrides]
 * @returns {OfferReceivedContext}
 */
export function makeOfferContext(overrides = {}) {
    return {
        platform: 'poshmark',
        listing_id: 'listing-abc123',
        listing_title: "Vintage Levi's 501 - Size 32",
        asking_price: 45,
        offer_amount: 30,
        buyer_id: 'buyer-xyz',
        ...overrides,
    }
}

/**
 * @param {Partial<BaseContract>} [overrides]
 * @returns {BaseContract}
 */
export function makeGrantContract(overrides = {}) {
    return /** @type {BaseContract} */ ({
        id: `grant-${randomUUID()}`,
        version: '1.0',
        type: 'grant-report-draft',
        status: 'created',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        participants: {
            writer: { id: 'agent-primary', type: 'agent' },
            resolver: { id: 'director', type: 'human' },
        },
        intent: {
            goal: 'Director reviews and approves grant report before submission',
            trigger: 'Agent compiled report from Drive data',
            context: /** @type {GrantReportDraftContext} */ ({
                funder_name: 'California Coastal Commission',
                grant_id: 'CCC-2026-Q1',
                report_period: 'Q1 2026',
                deadline: '2026-04-15',
                draft_path: 'projects/ccc-q1-report/draft-v1.md',
                data_sources: ['drive:doc-abc', 'drive:doc-def'],
            }),
        },
        ...overrides,
    })
}

/** @returns {{ id: string, type: 'human' }} */
export const humanResolver = () => ({ id: 'owner', type: /** @type {'human'} */ ('human') })

/** @returns {{ id: string, type: 'human' }} */
export const directorResolver = () => ({ id: 'director', type: /** @type {'human'} */ ('human') })

/** @returns {{ id: string, type: 'agent' }} */
export const agentWriter = () => ({ id: 'agent-primary', type: /** @type {'agent'} */ ('agent') })

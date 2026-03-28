/**
 * Etsy listing lookup tool — contributed by the artist-reseller .aurora package.
 *
 * This file is NOT imported by openclaw-plugin core. It is loaded at runtime
 * by the Phase 5 tool-contribution loader when the Etsy connector is active.
 *
 * To add this tool to the agent's context, declare it in aurora-registry.json
 * under the `tools` section (already done). The loader reads that declaration
 * and registers this module's export with the ContractRuntime at startup.
 *
 * The agent calls `aura_query_listing` during contract execution when it needs
 * the current asking price for an Etsy listing. Core has zero knowledge of Etsy.
 */

/**
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 * @import { PluginLogger } from '../../packages/openclaw-plugin/src/types/plugin-types.js'
 */

import { AuraConnectorStore } from '@aura/aura-pulse/api.js'

/**
 * @param {SQLiteContractStorage} storage
 * @param {PluginLogger} logger
 */
export function buildEtsyLookup(storage, logger) {
    const store = new AuraConnectorStore(storage, logger)

    return {
        name: 'aura_query_listing',
        description:
            'Fetch the current asking price and status for a marketplace listing. ' +
            'Supports Etsy (direct API via stored API key). ' +
            'Poshmark and Mercari have no public API — use the offer amount from email context instead.',
        parameters: {
            type: 'object',
            properties: {
                platform: {
                    type: 'string',
                    description: 'Selling platform: etsy | poshmark | mercari',
                },
                listing_id: {
                    type: 'string',
                    description: 'Platform-specific listing identifier',
                },
                reason: {
                    type: 'string',
                    description: 'Why the agent needs this information now',
                },
            },
            required: ['platform', 'listing_id', 'reason'],
        },

        /**
         * @param {string} _toolCallId
         * @param {{ platform: string, listing_id: string, reason: string }} params
         * @returns {Promise<{ content: Array<{ type: 'text', text: string }> }>}
         */
        async execute(_toolCallId, { platform, listing_id, reason }) {
            if (platform === 'etsy') {
                const creds = await store.readDecrypted('etsy')

                if (!creds || creds.status !== 'active' || !creds.oauth_token_enc) {
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                error: true,
                                platform: 'etsy',
                                capability_without: 'Cannot verify current Etsy listing prices.',
                                setup_hint: 'Connect Etsy in the Aura connectors panel to enable live price lookup.',
                            }),
                        }],
                    }
                }

                const res = await fetch(
                    `https://openapi.etsy.com/v3/application/listings/${encodeURIComponent(listing_id)}`,
                    { headers: { 'x-api-key': creds.oauth_token_enc } },
                )

                if (!res.ok) {
                    logger.warn(`[etsy-lookup] Etsy API returned ${res.status} for listing ${listing_id}`)
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify({
                                error: true,
                                platform: 'etsy',
                                status: res.status,
                                message: `Etsy API error ${res.status}. Check that the listing ID is correct and the API key is valid.`,
                            }),
                        }],
                    }
                }

                const data = /** @type {any} */ (await res.json())
                const priceAmount = data?.price?.amount
                const priceDivisor = data?.price?.divisor ?? 100
                const price = typeof priceAmount === 'number' ? priceAmount / priceDivisor : null

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            listing_id,
                            platform:  'etsy',
                            title:     data?.title ?? null,
                            price,
                            currency:  data?.price?.currency_code ?? 'USD',
                            status:    data?.state ?? null,
                            reason,
                        }),
                    }],
                }
            }

            // Poshmark and Mercari: no public API
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        error: true,
                        platform,
                        message: `No public API is available for ${platform}. Use the offer amount from the email context rather than attempting a live lookup.`,
                    }),
                }],
            }
        },
    }
}

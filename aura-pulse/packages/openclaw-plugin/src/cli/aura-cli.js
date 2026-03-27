/**
 * aura-cli.js — CLI surface for Aura Pulse plugin.
 *
 * Commands:
 *   pending                               — list pending/waiting_approval contracts
 *   resume --contract <id> --token <tok> --action <engage|resolve|abandon>
 *                                         — resume a paused contract via resume token
 *   connectors                            — list connector states (no credentials)
 *   status                                — print runtime/service health
 */

import { parseArgs } from 'node:util'

/**
 * @import { ContractRuntime } from '@aura/contract-runtime'
 * @import { SQLiteContractStorage } from '@aura/contract-runtime'
 */

/**
 * @typedef {object} AuraCliOptions
 * @property {ContractRuntime} runtime
 * @property {SQLiteContractStorage} storage
 * @property {import('../types/plugin-types.js').PluginLogger} logger
 * @property {string} agentId
 */

/**
 * Build and return the CLI command descriptor for OpenClaw `api.registerCli`.
 *
 * @param {AuraCliOptions} opts
 * @returns {{ name: string, description: string, execute: (args: string[]) => Promise<void> }}
 */
export function buildCli(opts) {
    const { runtime, storage, logger } = opts

    return {
        name: 'aura',
        description: 'Aura Pulse — manage contracts, connectors, and resume tokens.',
        async execute(args) {
            const [subcommand, ...rest] = args

            switch (subcommand) {
            case 'pending':
                await cmdPending(runtime, logger)
                break

            case 'resume':
                await cmdResume(runtime, rest, logger)
                break

            case 'connectors':
                await cmdConnectors(storage, logger)
                break

            case 'status':
                await cmdStatus(runtime, logger)
                break

            default:
                logger.info('Usage: aura <pending|resume|connectors|status>')
            }
        },
    }
}

/**
 * @param {ContractRuntime} runtime
 * @param {import('../types/plugin-types.js').PluginLogger} logger
 */
async function cmdPending(runtime, logger) {
    const contracts = await runtime.list({ status: ['waiting_approval', 'pending', 'active'] })
    if (contracts.length === 0) {
        logger.info('No pending contracts.')
        return
    }
    for (const c of contracts) {
        logger.info(`[${c.status}] ${c.id}  type=${c.type}  created=${c.created_at}`)
        if (c.surface) logger.info(`  surface: ${JSON.stringify(c.surface)}`)
    }
}

/**
 * @param {ContractRuntime} runtime
 * @param {string[]} args
 * @param {import('../types/plugin-types.js').PluginLogger} logger
 */
async function cmdResume(runtime, args, logger) {
    const { values } = parseArgs({
        args,
        options: {
            contract: { type: 'string' },
            token:    { type: 'string' },
            action:   { type: 'string' },
        },
        strict: false,
    })

    const contractId  = /** @type {string | undefined} */ (values['contract'])
    const resumeToken = /** @type {string | undefined} */ (values['token'])
    const action      = /** @type {string | undefined} */ (values['action'])
    if (!contractId || !action) {
        logger.info('Usage: aura resume --contract <id> --token <token> --action <engage|resolve|abandon>')
        return
    }

    const contract = await runtime.get(contractId)
    if (!contract) {
        logger.info(`Contract ${contractId} not found.`)
        return
    }

    /** @type {import('@aura/contract-runtime').ParticipantRef} */
    const actor = contract.participants?.resolver ?? { id: 'owner', type: 'human' }

    switch (action) {
    case 'engage':
        await runtime.transition(contractId, 'resolver_active', actor)
        logger.info(`Contract ${contractId} engaged.`)
        break
    case 'resolve':
        if (!resumeToken) {
            logger.info('Usage: aura resume --contract <id> --token <token> --action resolve')
            return
        }
        if (contract.status === 'waiting_approval') {
            await runtime.transition(contractId, 'resolver_active', actor)
        }
        await runtime.resume(contractId, resumeToken, actor, 'resolve')
        logger.info(`Contract ${contractId} resumed to executing.`)
        break
    case 'abandon':
        await runtime.transition(contractId, 'waiting_approval', actor)
        logger.info(`Contract ${contractId} abandoned.`)
        break
    default:
        logger.info('Unknown action. Use: engage | resolve | abandon')
    }
}

/**
 * @param {SQLiteContractStorage} storage
 * @param {import('../types/plugin-types.js').PluginLogger} logger
 */
async function cmdConnectors(storage, logger) {
    const connectors = await storage.readConnectors()
    if (connectors.length === 0) {
        logger.info('No connectors registered.')
        return
    }
    for (const c of connectors) {
        // Omit encrypted token fields — never log
        const { oauth_token_enc: _ot, refresh_token_enc: _rt, ...safe } = c
        logger.info(JSON.stringify(safe))
    }
}

/**
 * @param {ContractRuntime} runtime
 * @param {import('../types/plugin-types.js').PluginLogger} logger
 */
async function cmdStatus(runtime, logger) {
    const allContracts = await runtime.list({})
    const byStatus     = /** @type {Record<string, number>} */ ({})
    for (const c of allContracts) {
        byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
    }
    logger.info('Aura Pulse — runtime status')
    logger.info(`  total contracts: ${allContracts.length}`)
    for (const [status, count] of Object.entries(byStatus)) {
        logger.info(`    ${status}: ${count}`)
    }
}

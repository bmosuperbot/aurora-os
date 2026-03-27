/**
 * index.js — Aura Pulse OpenClaw plugin entry point.
 *
 * Wires together ContractRuntimeService, WebSocketService, all tools,
 * the CLI, and the static HTTP route via `definePluginEntry`.
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

import { normalizeConfig }            from './src/config/schema.js'
import { ContractRuntimeService }     from './src/services/contract-runtime-service.js'
import { EngramCompletionBridge }     from './src/services/completion-bridge.js'
import { WebSocketService }           from './src/services/websocket-service.js'
import { FileBridgeWatcher }          from './src/services/file-bridge-watcher.js'
import { registerStaticRoute, registerHistoryRoute } from './setup-entry.js'

import { buildSurfaceDecision }       from './src/tools/aura-surface-decision.js'
import { buildReportToPrimary }       from './src/tools/aura-report-to-primary.js'
import { buildLogAction }             from './src/tools/aura-log-action.js'
import { buildQueryContracts }        from './src/tools/aura-query-contracts.js'
import { buildQueryConnections }      from './src/tools/aura-query-connections.js'
import { buildRequestConnection }     from './src/tools/aura-request-connection.js'
import { buildFsRead }                from './src/tools/aura-fs-read.js'
import { buildFsWrite }               from './src/tools/aura-fs-write.js'
import { buildFsPatch }               from './src/tools/aura-fs-patch.js'
import { buildFsMove }                from './src/tools/aura-fs-move.js'
import { buildFsDelete }              from './src/tools/aura-fs-delete.js'
import { buildFsList }                from './src/tools/aura-fs-list.js'
import { buildFsArchive }             from './src/tools/aura-fs-archive.js'
import { buildFsSearch }              from './src/tools/aura-fs-search.js'
import { buildCli }                   from './src/cli/aura-cli.js'
import { LockManager }               from './src/fs/locks.js'

const AGENT_ID = 'aura-pulse'

/**
 * Adapt the plugin's internal RegisteredTool shape to OpenClaw's AgentTool shape.
 * This keeps the tool implementations simple while satisfying the host SDK contract
 * with an explicit boundary adapter instead of a broad type cast.
 *
 * @param {import('./src/types/plugin-types.js').RegisteredTool} tool
 * @param {string} label
 * @returns {{
 *   name: string,
 *   description: string,
 *   parameters: unknown,
 *   label: string,
 *   execute: (
 *     toolCallId: string,
 *     params: Record<string, unknown>,
 *     signal?: AbortSignal,
 *     onUpdate?: (partialResult: unknown) => void,
 *   ) => Promise<{ content: Array<{ type: 'text', text: string }>, details: undefined, isError?: boolean }>
 * }}
 */
function toAgentTool(tool, label) {
    return {
        ...tool,
        label,
        async execute(toolCallId, params, _signal, _onUpdate) {
            const result = await tool.execute(
                toolCallId,
                /** @type {Record<string, unknown>} */ (params),
            )

            return {
                ...result,
                details: undefined,
            }
        },
    }
}

export default definePluginEntry({
    id: 'aura-pulse',
    name: 'Aura Pulse',
    description: 'Sovereign contract runtime, PARA filesystem, and WebSocket surface for Aura OS.',

    /**
        * @param {import('./src/types/plugin-types.js').OpenClawPluginApi} api
     */
    async register(api) {
        const raw    = api.pluginConfig ?? {}
        const config = normalizeConfig(raw)

        const bridge         = new EngramCompletionBridge(config, api.logger)
        const runtimeService = new ContractRuntimeService(config, bridge)

        // Start eagerly so tools can be bound to the live runtime synchronously.
        // Services are also registered below so OpenClaw manages stop() on shutdown.
        await runtimeService.start()
        const runtime = runtimeService.getRuntime()
        const storage = runtimeService.getStorage()
        const paths   = runtimeService.getPaths()
        const locks   = new LockManager(storage, api.logger)

        const wsService = new WebSocketService(config, runtime, storage, paths.signalPath, api.logger)
        await wsService.start()

        const fileBridgeWatcher = new FileBridgeWatcher(
            paths.projectsDir,
            storage,
            api.logger,
            () => wsService.nudge(),
        )
        fileBridgeWatcher.start()

        // --- Lifecycle registration (start is no-op — already started above) ---
        api.registerService({
            id: 'aura-runtime',
            start: async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => { /* started eagerly in register() */ },
            stop:  async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => runtimeService.stop(),
        })
        api.registerService({
            id: 'aura-websocket',
            start: async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => { /* started eagerly in register() */ },
            stop:  async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => wsService.stop(),
        })
        api.registerService({
            id: 'aura-file-bridge-watcher',
            start: async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => { /* started eagerly in register() */ },
            stop:  async (
                /** @type {import('./src/types/plugin-types.js').OpenClawPluginServiceContext} */ _ctx,
            ) => fileBridgeWatcher.stop(),
        })

        // --- Contract tools ---
        api.registerTool(toAgentTool(buildSurfaceDecision(runtime), 'Surface Decision'))
        api.registerTool(toAgentTool(buildReportToPrimary(runtime), 'Report To Primary'))
        api.registerTool(toAgentTool(buildLogAction(runtime), 'Log Action'))
        api.registerTool(toAgentTool(buildQueryContracts(runtime), 'Query Contracts'))
        api.registerTool(toAgentTool(buildQueryConnections(storage), 'Query Connections'))
        api.registerTool(toAgentTool(buildRequestConnection(storage, wsService), 'Request Connection'))

        // --- FS tools ---
        api.registerTool(toAgentTool(buildFsRead(paths, locks), 'FS Read'))
        api.registerTool(toAgentTool(buildFsWrite(paths, locks, runtime, AGENT_ID), 'FS Write'))
        api.registerTool(toAgentTool(buildFsPatch(paths, locks, runtime, AGENT_ID), 'FS Patch'))
        api.registerTool(toAgentTool(buildFsMove(paths, locks, runtime, AGENT_ID), 'FS Move'))
        api.registerTool(toAgentTool(buildFsDelete(paths, locks, runtime, AGENT_ID), 'FS Delete'))
        api.registerTool(toAgentTool(buildFsList(paths), 'FS List'))
        api.registerTool(toAgentTool(buildFsArchive(paths, locks, runtime, AGENT_ID), 'FS Archive'))
        api.registerTool(toAgentTool(buildFsSearch(paths), 'FS Search'))

        // --- CLI ---
        // buildCli returns { name, description, execute(args) }.
        // OpenClaw expects a Commander registrar: (ctx) => void.
        const cli = buildCli({ runtime, storage, logger: api.logger, agentId: AGENT_ID })
        api.registerCli((/** @type {import('./src/types/plugin-types.js').OpenClawPluginCliContext} */ ctx) => {
            ctx.program
                .command(cli.name)
                .description(cli.description)
                .allowUnknownOption()
                .argument('[args...]', 'subcommand and arguments')
                .action(async (
                    /** @type {unknown} */ actionArgs,
                ) => {
                    // Commander passes variadic args as first param, opts as last
                    const args = /** @type {string[]} */ (actionArgs)
                    await cli.execute(args)
                })
        })

        // --- Static HTTP route (Pulse UI) ---
        registerStaticRoute(api, config.pulseStaticDir)

        // --- History JSON route ---
        registerHistoryRoute(api, storage)
    },
})

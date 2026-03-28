/**
 * index.js — Aura Pulse OpenClaw plugin entry point.
 *
 * Wires together ContractRuntimeService, WebSocketService, all tools,
 * the CLI, and the static HTTP route via `definePluginEntry`.
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

import { normalizeConfig }            from './src/config/schema.js'
import { ContractRuntimeService }     from './src/services/contract-runtime-service.js'
import { EngramCompletionBridge }     from './src/services/completion-bridge.js'
import { WebSocketService }           from './src/services/websocket-service.js'
import { FileBridgeWatcher }          from './src/services/file-bridge-watcher.js'
import { registerStaticRoute, registerHistoryRoute } from './setup-entry.js'
import { OpenClawChannelConnector }   from './src/connectors/openclaw-channel-connector.js'
import { AuraConnectorStore }         from './src/connectors/aura-connector-store.js'

import { buildSurfaceDecision }       from './src/tools/aura-surface-decision.js'
import { buildReportToPrimary }       from './src/tools/aura-report-to-primary.js'
import { buildLogAction }             from './src/tools/aura-log-action.js'
import { buildQueryContracts }        from './src/tools/aura-query-contracts.js'
import { buildQueryConnections }      from './src/tools/aura-query-connections.js'
import { buildCompleteContract }      from './src/tools/aura-complete-contract.js'
import { buildRequestConnection }     from './src/tools/aura-request-connection.js'
import { buildFsRead }                from './src/tools/aura-fs-read.js'
import { buildFsWrite }               from './src/tools/aura-fs-write.js'
import { buildFsPatch }               from './src/tools/aura-fs-patch.js'
import { buildFsMove }                from './src/tools/aura-fs-move.js'
import { buildFsDelete }              from './src/tools/aura-fs-delete.js'
import { buildFsList }                from './src/tools/aura-fs-list.js'
import { buildFsArchive }             from './src/tools/aura-fs-archive.js'
import { buildFsSearch }              from './src/tools/aura-fs-search.js'
import { buildDomainTypeDefinitions } from './src/domain-types/loader.js'
import { buildCli }                   from './src/cli/aura-cli.js'
import { LockManager }               from './src/fs/locks.js'

const AGENT_ID = 'aura-pulse'

const execAsync = promisify(exec)

/**
 * Run a shell command and return stdout. Errors are NOT thrown —
 * callers must check the return value.
 *
 * @param {string} cmd
 * @returns {Promise<{ stdout: string, stderr: string, error: Error | null }>}
 */
async function execCmd(cmd) {
    try {
        const { stdout, stderr } = await execAsync(cmd)
        return { stdout, stderr, error: null }
    } catch (/** @type {any} */ err) {
        return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', error: err }
    }
}

/**
 * Run a command with arguments as an array — no shell interpolation.
 *
 * @param {string} bin
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string, error: Error | null }>}
 */
function spawnCmd(bin, args) {
    return new Promise((resolve) => {
        execFile(bin, args, (error, stdout, stderr) => {
            if (error) resolve({ stdout: stdout ?? '', stderr: stderr ?? '', error })
            else resolve({ stdout, stderr, error: null })
        })
    })
}

/**
 * @typedef {object} RegistryPlugin
 * @property {string} id
 * @property {string} package
 * @property {string} version
 * @property {string} description
 */

/**
 * @typedef {object} RegistryManifest
 * @property {{ required: RegistryPlugin[], optional: RegistryPlugin[] }} plugins
 * @property {{ plugins: { allow: string[], load?: unknown } }} openclawConfig
 */

/**
 * Install any required registry plugins that are not yet loaded, then
 * restart the gateway if installs occurred.
 *
 * @param {import('./src/types/plugin-types.js').OpenClawPluginApi} api
 * @param {RegistryManifest} registry
 * @returns {Promise<boolean>} true if all required plugins are confirmed installed
 */
async function bootstrapRegistry(api, registry) {
    const { stdout, error } = await execCmd('openclaw plugins list --json')
    if (error) {
        api.logger.warn('[aura-registry] could not list plugins — skipping bootstrap')
        return false
    }

    let loaded = /** @type {string[]} */ ([])
    try {
        loaded = JSON.parse(stdout).map((/** @type {{ id: string }} */ p) => p.id)
    } catch {
        api.logger.warn('[aura-registry] could not parse plugins list — skipping bootstrap')
        return false
    }

    let needsRestart = false
    for (const plugin of registry.plugins.required) {
        if (!loaded.includes(plugin.id)) {
            api.logger.info(`[aura-registry] installing ${plugin.package}@${plugin.version}`)
            const result = await spawnCmd('openclaw', ['plugins', 'install', `${plugin.package}@${plugin.version}`])
            if (result.error) {
                api.logger.warn(`[aura-registry] install failed for ${plugin.id}: ${result.stderr}`)
            } else {
                needsRestart = true
            }
        }
    }

    if (needsRestart) {
        api.logger.info('[aura-registry] restarting gateway after plugin installs')
        await execCmd('openclaw gateway restart')
    }

    return true
}

/**
 * Write plugins.allow to openclaw.json on first run if absent.
 *
 * @param {import('./src/types/plugin-types.js').OpenClawPluginApi} api
 * @param {object} registry
 * @returns {Promise<void>}
 */
async function ensureOpenClawConfig(api, /** @type {RegistryManifest} */ registry) {
    const configPath = join(homedir(), '.openclaw', 'openclaw.json')
    let current = /** @type {Record<string, unknown>} */ ({})
    try {
        current = JSON.parse(await readFile(configPath, 'utf8'))
    } catch {
        // File does not exist or is not valid JSON — start fresh
    }

    const plugins = /** @type {Record<string, unknown>} */ (
        (typeof current['plugins'] === 'object' && current['plugins'] !== null)
            ? current['plugins']
            : {}
    )

    if (!plugins['allow']) {
        plugins['allow'] = registry.openclawConfig.plugins.allow
        if (!plugins['load']) plugins['load'] = registry.openclawConfig.plugins.load
        current['plugins'] = plugins
        try {
            await writeFile(configPath, JSON.stringify(current, null, 2))
            api.logger.info('[aura-registry] wrote plugins.allow to openclaw.json')
        } catch (err) {
            api.logger.warn(`[aura-registry] could not write openclaw.json: ${String(err)}`)
        }
    }
}

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

        // --- Load package-supplied domain types (artist-reseller/domain-types.json) ---
        // Adding a new contract type requires only a JSON data change — no code update.
        try {
            const { default: domainTypesManifest } = await import('../artist-reseller/domain-types.json', { with: { type: 'json' } })
            for (const def of buildDomainTypeDefinitions(/** @type {import('./src/domain-types/loader.js').DomainTypesManifest} */ (domainTypesManifest))) {
                runtime.registerType(def)
                api.logger.debug?.(`[domain-types] registered: ${def.type}`)
            }
        } catch (err) {
            api.logger.warn(`[domain-types] failed to load artist-reseller/domain-types.json: ${String(err)}`)
        }

        // --- Connector seeding (openclaw-channel) ---
        const channelConnector = new OpenClawChannelConnector(storage, api.logger)
        const auraStore        = new AuraConnectorStore(storage, api.logger)

        await channelConnector.seedIfAbsent('gmail',
            'Cannot monitor the business inbox or reply to buyer messages.',
            'Can receive offer emails and send replies on behalf of the business.')

        await channelConnector.seedIfAbsent('calendar',
            'Cannot check the owner\'s schedule for deadlines.',
            'Can read your schedule and create reminders for listing and shipping deadlines.')

        await channelConnector.seedIfAbsent('drive',
            'Cannot access project documents and reports.',
            'Can read and write project documents and reports in Google Drive.')

        // Reflect actual Gmail hook state — mark active if hooks.gmail is configured
        const hooksConfig = /** @type {Record<string, unknown> | undefined} */ (
            typeof api.config['hooks'] === 'object' && api.config['hooks'] !== null
                ? api.config['hooks']
                : undefined
        )
        const gmailHookConfig = hooksConfig && typeof hooksConfig['gmail'] === 'object' && hooksConfig['gmail'] !== null
            ? /** @type {Record<string, unknown>} */ (hooksConfig['gmail'])
            : null
        const gmailConfigured = Boolean(gmailHookConfig?.['account'])

        if (gmailConfigured) {
            const existing = await storage.readConnector('gmail')
            if (existing) {
                await storage.writeConnector({
                    ...existing,
                    status: 'active',
                    connected_at: existing.connected_at ?? new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
            }
        }

        // --- Connector seeding (aura-connector) ---
        await auraStore.seedIfAbsent({
            id: 'etsy',
            source: 'aura-connector',
            status: 'not-offered',
            capability_without: 'Cannot verify current Etsy listing prices when an offer arrives.',
            capability_with: 'Can look up live asking price for any Etsy listing.',
            updated_at: new Date().toISOString(),
        })

        // --- Registry bootstrap (required plugins + plugins.allow) ---
        let registryStatus = /** @type {import('./src/services/websocket-service.js').OnboardingStatus | null} */ (null)
        try {
            const registryMod = await import('../artist-reseller/aurora-registry.json', { with: { type: 'json' } })
            const registry = /** @type {RegistryManifest} */ (registryMod.default)
            await bootstrapRegistry(api, registry)
            await ensureOpenClawConfig(api, registry)

            // Build onboarding status for Pulse
            const { stdout } = await execCmd('openclaw plugins list --json')
            let loadedIds = /** @type {string[]} */ ([])
            try { loadedIds = JSON.parse(stdout).map((/** @type {{ id: string }} */ p) => p.id) } catch { /* ignore */ }

            const items = [
                ...registry.plugins.required.map((/** @type {{ id: string, description: string }} */ p) => ({
                    id: p.id,
                    label: p.description,
                    status: loadedIds.includes(p.id) ? /** @type {const} */ ('installed') : /** @type {const} */ ('missing'),
                    tier: /** @type {const} */ ('required'),
                })),
                ...registry.plugins.optional.map((/** @type {{ id: string, description: string }} */ p) => ({
                    id: p.id,
                    label: p.description,
                    status: loadedIds.includes(p.id) ? /** @type {const} */ ('installed') : /** @type {const} */ ('not-installed'),
                    tier: /** @type {const} */ ('optional'),
                })),
                {
                    id: 'gmail',
                    label: 'Gmail inbox',
                    status: gmailConfigured ? /** @type {const} */ ('installed') : /** @type {const} */ ('pending'),
                    tier: /** @type {const} */ ('required'),
                },
            ]

            const incomplete = items.some(i => i.tier === 'required' && i.status !== 'installed')
            registryStatus = { items, incomplete }
        } catch (err) {
            api.logger.warn(`[aura-registry] bootstrap error: ${String(err)}`)
        }

        const wsService = new WebSocketService(config, runtime, storage, paths.signalPath, api.logger, registryStatus)
        await wsService.start()

        // First-run Gmail card push if wizard has not been run
        if (!gmailConfigured) {
            const existing = await storage.readConnector('gmail')
            if (existing) {
                wsService.pushConnectorRequest({
                    id:                 existing.id,
                    connector_id:       'gmail',
                    connector_name:     'Gmail',
                    offer_text:         'Connect Gmail so the agent can monitor the business inbox and reply to buyer messages.',
                    source:             'openclaw-channel',
                    status:             'not-offered',
                    capability_without: existing.capability_without,
                    capability_with:    existing.capability_with,
                    flow_type:          'manual_guide',
                    guide_steps: [
                        'Install gog: brew install gogcli',
                        'Authorize your agent Gmail account: gog auth login --account studio-ops@gmail.com',
                        'Run the Gmail wizard: openclaw webhooks gmail setup --account studio-ops@gmail.com',
                        'Restart the gateway: openclaw gateway restart',
                    ],
                })
            }
        }

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
        api.registerTool(toAgentTool(buildCompleteContract(runtime), 'Complete Contract'))

        // --- FS tools ---
        api.registerTool(toAgentTool(buildFsRead(paths, locks), 'FS Read'))
        api.registerTool(toAgentTool(buildFsWrite(paths, locks, runtime, AGENT_ID), 'FS Write'))
        api.registerTool(toAgentTool(buildFsPatch(paths, locks, runtime, AGENT_ID), 'FS Patch'))
        api.registerTool(toAgentTool(buildFsMove(paths, locks, runtime, AGENT_ID), 'FS Move'))
        api.registerTool(toAgentTool(buildFsDelete(paths, locks, runtime, AGENT_ID), 'FS Delete'))
        api.registerTool(toAgentTool(buildFsList(paths), 'FS List'))
        api.registerTool(toAgentTool(buildFsArchive(paths, locks, runtime, AGENT_ID), 'FS Archive'))
        api.registerTool(toAgentTool(buildFsSearch(paths), 'FS Search'))
        // aura_query_listing contributed by .aurora package tools (Phase 5 loader)

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

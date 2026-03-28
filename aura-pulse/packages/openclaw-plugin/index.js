/**
 * index.js — Aura Pulse OpenClaw plugin entry point.
 *
 * Wires together ContractRuntimeService, WebSocketService, all tools,
 * the CLI, and the static HTTP route via `definePluginEntry`.
 */

import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'

import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { normalizeConfig }            from './src/config/schema.js'
import { loadAuroraPackageJsonSync }  from './src/config/aurora-package.js'
import { ContractRuntimeService }     from './src/services/contract-runtime-service.js'
import { EngramCompletionBridge }     from './src/services/completion-bridge.js'
import { WebSocketService }           from './src/services/websocket-service.js'
import { FileBridgeWatcher }          from './src/services/file-bridge-watcher.js'
import { ContractExecutor }           from './src/services/contract-executor.js'
import { loadContributedTools }       from './src/services/tool-loader.js'
import { ensureTriggers }             from './src/services/trigger-bootstrap.js'
import { bootstrapRegistry, ensureOpenClawConfig } from './src/services/registry-bootstrap.js'
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
const PLUGIN_STATE_KEY = Symbol.for('aura-pulse.plugin-state')
const DEFAULT_REGISTRY_MANIFEST = /** @type {RegistryManifest} */ ({
    plugins: { required: [], optional: [] },
    tools: [],
    triggers: [],
    openclawConfig: { plugins: { allow: ['aura-pulse'] } },
})
const DEFAULT_DOMAIN_TYPES_MANIFEST = /** @type {import('./src/domain-types/loader.js').DomainTypesManifest} */ ({
    version: '1.0',
    types: [],
})

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

/**
 * @template {object} T
 * @param {string} label
 * @param {() => T} getTarget
 * @returns {T}
 */
function createLazyProxy(label, getTarget) {
    return /** @type {T} */ (new Proxy({}, {
        get(_target, prop) {
            if (prop === Symbol.toStringTag) {
                return label
            }

            const target = getTarget()
            const value = Reflect.get(target, prop, target)
            return typeof value === 'function' ? value.bind(target) : value
        },
        set(_target, prop, value) {
            const target = getTarget()
            Reflect.set(target, prop, value, target)
            return true
        },
        has(_target, prop) {
            return prop in getTarget()
        },
        getOwnPropertyDescriptor() {
            return {
                configurable: true,
                enumerable: true,
            }
        },
    }))
}

function getGlobalPluginState() {
    const globalState = /** @type {Record<PropertyKey, unknown>} */ (globalThis)
    if (!globalState[PLUGIN_STATE_KEY]) {
        globalState[PLUGIN_STATE_KEY] = {
            fullRegistered: false,
            manager: null,
        }
    }

    return /** @type {{ fullRegistered: boolean, manager: ReturnType<typeof createPluginManager> | null }} */ (globalState[PLUGIN_STATE_KEY])
}

/**
 * @param {import('./src/config/schema.js').AuraPluginConfig} config
 */
function createPluginManager(config, registryManifest, domainTypesManifest) {
    return {
        /** @type {import('./src/types/plugin-types.js').OpenClawPluginApi | null} */
        _api: null,
        /** @type {ContractRuntimeService | null} */
        _runtimeService: null,
        /** @type {WebSocketService | null} */
        _wsService: null,
        /** @type {FileBridgeWatcher | null} */
        _fileBridgeWatcher: null,
        /** @type {Promise<void> | null} */
        _startPromise: null,
        /** @type {Promise<void> | null} */
        _stopPromise: null,
        /** @type {boolean} */
        _bootstrapDone: false,
        /** @type {boolean} */
        _triggerSetupDone: false,
        /** @type {boolean} */
        _contributedToolsRegistered: false,

        /**
         * @param {import('./src/types/plugin-types.js').OpenClawPluginApi} api
         */
        bindApi(api) {
            this._api = api
        },

        getRuntime() {
            if (!this._runtimeService) {
                throw new Error('Aura Pulse runtime is not started')
            }
            return this._runtimeService.getRuntime()
        },

        getStorage() {
            if (!this._runtimeService) {
                throw new Error('Aura Pulse storage is not started')
            }
            return this._runtimeService.getStorage()
        },

        getPaths() {
            if (!this._runtimeService) {
                throw new Error('Aura Pulse paths are not available before startup')
            }
            return this._runtimeService.getPaths()
        },

        getWebSocketService() {
            if (!this._wsService) {
                throw new Error('Aura Pulse websocket service is not started')
            }
            return this._wsService
        },

        async ensureStarted() {
            if (this._startPromise) {
                await this._startPromise
                return
            }
            if (this._runtimeService && this._wsService) {
                return
            }

            const api = this._api
            if (!api) {
                throw new Error('Aura Pulse plugin manager is not bound to an OpenClaw API context')
            }

            this._startPromise = (async () => {
                try {
                    const bridge = new EngramCompletionBridge(config, api.logger)
                    const runtimeService = new ContractRuntimeService(config, bridge)
                    await runtimeService.start()
                    this._runtimeService = runtimeService

                    const runtime = runtimeService.getRuntime()
                    const storage = runtimeService.getStorage()
                    const paths = runtimeService.getPaths()
                    const executor = new ContractExecutor({ api, auraRoot: config.auraRoot, storage, logger: api.logger })
                    runtimeService.setExecutionNotifier(executor)

                    for (const def of buildDomainTypeDefinitions(domainTypesManifest)) {
                        if (runtime.hasType(def.type)) {
                            api.logger.debug?.(`[domain-types] skipped already-registered type: ${def.type}`)
                            continue
                        }
                        runtime.registerType(def)
                        api.logger.debug?.(`[domain-types] registered: ${def.type}`)
                    }

                    const channelConnector = new OpenClawChannelConnector(storage, api.logger)
                    const auraStore = new AuraConnectorStore(storage, api.logger)

                    await channelConnector.seedIfAbsent('gmail',
                        'Cannot monitor the business inbox or reply to buyer messages.',
                        'Can receive offer emails and send replies on behalf of the business.')

                    await channelConnector.seedIfAbsent('calendar',
                        'Cannot check the owner\'s schedule for deadlines.',
                        'Can read your schedule and create reminders for listing and shipping deadlines.')

                    await channelConnector.seedIfAbsent('drive',
                        'Cannot access project documents and reports.',
                        'Can read and write project documents and reports in Google Drive.')

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

                    await auraStore.seedIfAbsent({
                        id: 'etsy',
                        source: 'aura-connector',
                        status: 'not-offered',
                        capability_without: 'Cannot verify current Etsy listing prices when an offer arrives.',
                        capability_with: 'Can look up live asking price for any Etsy listing.',
                        updated_at: new Date().toISOString(),
                    })

                    let registryStatus = /** @type {import('./src/services/websocket-service.js').OnboardingStatus | null} */ (null)
                    try {
                        const { stdout } = await execCmd('openclaw plugins list --json')
                        let loadedIds = /** @type {string[]} */ ([])
                        try {
                            loadedIds = JSON.parse(stdout).map((/** @type {{ id: string }} */ plugin) => plugin.id)
                        } catch {
                            loadedIds = []
                        }

                        const items = [
                            ...registryManifest.plugins.required.map((plugin) => ({
                                id: plugin.id,
                                label: plugin.description,
                                status: loadedIds.includes(plugin.id) ? /** @type {const} */ ('installed') : /** @type {const} */ ('missing'),
                                tier: /** @type {const} */ ('required'),
                            })),
                            ...registryManifest.plugins.optional.map((plugin) => ({
                                id: plugin.id,
                                label: plugin.description,
                                status: loadedIds.includes(plugin.id) ? /** @type {const} */ ('installed') : /** @type {const} */ ('not-installed'),
                                tier: /** @type {const} */ ('optional'),
                            })),
                            {
                                id: 'gmail',
                                label: 'Gmail inbox',
                                status: gmailConfigured ? /** @type {const} */ ('installed') : /** @type {const} */ ('pending'),
                                tier: /** @type {const} */ ('required'),
                            },
                        ]

                        registryStatus = {
                            items,
                            incomplete: items.some((item) => item.tier === 'required' && item.status !== 'installed'),
                        }
                    } catch {
                        registryStatus = null
                    }

                    const wsService = new WebSocketService(config, runtime, storage, paths.signalPath, api.logger, registryStatus, executor)
                    await wsService.start()
                    this._wsService = wsService

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
                    this._fileBridgeWatcher = fileBridgeWatcher

                    if (!this._bootstrapDone) {
                        await bootstrapRegistry(api, registryManifest, config, execCmd, spawnCmd)
                        await ensureOpenClawConfig(api, registryManifest, config)
                        this._bootstrapDone = true
                    }

                    if (!this._triggerSetupDone) {
                        await ensureTriggers(registryManifest, api, config)
                        this._triggerSetupDone = true
                    }

                    if (!this._contributedToolsRegistered) {
                        await loadContributedTools(registryManifest, config.auraRoot, storage, api.logger, (tool) => {
                            api.registerTool(toAgentTool(tool, tool.name))
                        })
                        this._contributedToolsRegistered = true
                    }
                } catch (err) {
                    await this.stop().catch(() => undefined)
                    throw err
                }
            })()

            try {
                await this._startPromise
            } finally {
                this._startPromise = null
            }
        },

        async stop() {
            if (this._stopPromise) {
                await this._stopPromise
                return
            }

            this._stopPromise = (async () => {
                await this._fileBridgeWatcher?.stop().catch(() => undefined)
                this._fileBridgeWatcher = null
                await this._wsService?.stop().catch(() => undefined)
                this._wsService = null
                await this._runtimeService?.stop().catch(() => undefined)
                this._runtimeService = null
            })()

            try {
                await this._stopPromise
            } finally {
                this._stopPromise = null
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
    register(api) {
        if (api.registrationMode !== 'full') {
            api.logger.debug?.(`[aura-pulse] skipping registration for mode=${api.registrationMode}`)
            return
        }

        const state = getGlobalPluginState()
        if (state.fullRegistered) {
            api.logger.debug?.('[aura-pulse] full registration already completed for this process')
            return
        }

        const raw = api.pluginConfig ?? {}
        const config = normalizeConfig(raw)
        const registryManifest = loadAuroraPackageJsonSync(
            config.auraRoot,
            'artist-reseller',
            'aurora-registry.json',
            DEFAULT_REGISTRY_MANIFEST,
            api.logger,
        )
        const domainTypesManifest = loadAuroraPackageJsonSync(
            config.auraRoot,
            'artist-reseller',
            'domain-types.json',
            DEFAULT_DOMAIN_TYPES_MANIFEST,
            api.logger,
        )
        const defaultCompleteRequiresByType = Object.fromEntries(
            (domainTypesManifest?.types ?? []).map((entry) => [
                entry.type,
                Array.isArray(entry.default_complete_requires) ? entry.default_complete_requires : [],
            ]),
        )

        const manager = state.manager ?? createPluginManager(config, registryManifest, domainTypesManifest)
        manager.bindApi(api)
        state.manager = manager
        state.fullRegistered = true

        const runtime = createLazyProxy('ContractRuntime', () => manager.getRuntime())
        const storage = createLazyProxy('SQLiteContractStorage', () => manager.getStorage())
        const paths = createLazyProxy('AuraPaths', () => manager.getPaths())
        const wsService = {
            pushConnectorRequest(payload) {
                manager.getWebSocketService().pushConnectorRequest(payload)
            },
            pushConnectorComplete(connectorId, status) {
                manager.getWebSocketService().pushConnectorComplete(connectorId, status)
            },
            nudge() {
                manager.getWebSocketService().nudge()
            },
        }
        const locks = new LockManager(storage, api.logger)

        api.registerService({
            id: 'aura-runtime-stack',
            start: async () => {
                await manager.ensureStarted()
            },
            stop: async () => {
                await manager.stop()
            },
        })

        // --- Contract tools ---
    api.registerTool(toAgentTool(buildSurfaceDecision(runtime, { defaultCompleteRequiresByType: defaultCompleteRequiresByType }), 'Surface Decision'))
        api.registerTool(toAgentTool(buildReportToPrimary(runtime), 'Report To Primary'))
        api.registerTool(toAgentTool(buildLogAction(runtime), 'Log Action'))
        api.registerTool(toAgentTool(buildQueryContracts(runtime), 'Query Contracts'))
        api.registerTool(toAgentTool(buildQueryConnections(storage), 'Query Connections'))
        api.registerTool(toAgentTool(buildRequestConnection(storage, wsService), 'Request Connection'))
        api.registerTool(toAgentTool(buildCompleteContract(runtime, storage), 'Complete Contract'))

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
        }, {
            commands: [cli.name],
            descriptors: [{ name: cli.name, description: cli.description, hasSubcommands: true }],
        })

        // --- Static HTTP route (Pulse UI) ---
        registerStaticRoute(api, config.pulseStaticDir)

        // --- History JSON route ---
        registerHistoryRoute(api, storage)
    },
})

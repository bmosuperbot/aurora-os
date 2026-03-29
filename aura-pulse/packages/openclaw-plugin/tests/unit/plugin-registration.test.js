import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('openclaw/plugin-sdk/plugin-entry', () => ({
    definePluginEntry(entry) {
        return entry
    },
}))

const __dirname = dirname(fileURLToPath(import.meta.url))
const auraRoot = resolve(__dirname, '../../../..')
const PLUGIN_STATE_KEY = Symbol.for('aura-pulse.plugin-state')

function makeApi() {
    const registeredTools = []
    const registeredServices = []
    const registeredRoutes = []
    const registeredCli = []

    return {
        registrationMode: 'full',
        config: {},
        pluginConfig: {
            auraRoot,
            workspaceDir: auraRoot,
            bootstrapEnabled: false,
        },
        logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
        },
        registerTool(tool) {
            registeredTools.push(tool)
        },
        registerService(service) {
            registeredServices.push(service)
        },
        registerHttpRoute(route) {
            registeredRoutes.push(route)
        },
        registerCli(registrar, opts) {
            registeredCli.push({ registrar, opts })
        },
        __registeredTools: registeredTools,
        __registeredServices: registeredServices,
        __registeredRoutes: registeredRoutes,
        __registeredCli: registeredCli,
    }
}

describe('Aura plugin registration', () => {
    beforeEach(() => {
        delete globalThis[PLUGIN_STATE_KEY]
        vi.resetModules()
    })

    it('registers tools for each api context in the same process', async () => {
        const { default: plugin } = await import('../../index.js')
        const api1 = makeApi()
        const api2 = makeApi()

        plugin.register(api1)
        plugin.register(api2)

        const toolNames1 = api1.__registeredTools.map((tool) => tool.name)
        const toolNames2 = api2.__registeredTools.map((tool) => tool.name)

        expect(toolNames1).toContain('aura_surface_decision')
        expect(toolNames1).toContain('aura_query_connections')
        expect(toolNames2).toContain('aura_surface_decision')
        expect(toolNames2).toContain('aura_query_connections')
        expect(toolNames2).toEqual(toolNames1)
        expect(api1.__registeredServices).toHaveLength(1)
        expect(api2.__registeredServices).toHaveLength(1)
    })
})
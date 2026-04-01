import fs from 'node:fs/promises'
import path from 'node:path'

const configDir = process.env.OPENCLAW_CONFIG_DIR
if (!configDir) {
    console.error('OPENCLAW_CONFIG_DIR is required')
    process.exit(1)
}
const gatewayPort = process.env.OPENCLAW_GATEWAY_PORT || '28789'

const configPath = path.join(configDir, 'openclaw.json')
const pluginPath = '/home/node/.openclaw/extensions/aura-pulse'
const legacyPluginPath = '/workspaces/aurora-os/aura-pulse/dist/openclaw-plugin-standalone'
const workspacePluginPath = '/home/node/.openclaw/workspace/openclaw-plugin-standalone'

let current = {}
try {
    current = JSON.parse(await fs.readFile(configPath, 'utf8'))
} catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') {
        throw error
    }
}

const next = current && typeof current === 'object' ? current : {}
next.plugins = next.plugins && typeof next.plugins === 'object' ? next.plugins : {}

const allow = Array.isArray(next.plugins.allow) ? next.plugins.allow : []
if (!allow.includes('aura-pulse')) {
    allow.push('aura-pulse')
}
next.plugins.allow = allow

next.plugins.load = next.plugins.load && typeof next.plugins.load === 'object' ? next.plugins.load : {}
const loadPaths = Array.isArray(next.plugins.load.paths)
    ? next.plugins.load.paths.filter((entry) => entry !== legacyPluginPath && entry !== workspacePluginPath)
    : []
if (!loadPaths.includes(pluginPath)) {
    loadPaths.push(pluginPath)
}
next.plugins.load.paths = loadPaths

next.gateway = next.gateway && typeof next.gateway === 'object' ? next.gateway : {}
next.gateway.controlUi = next.gateway.controlUi && typeof next.gateway.controlUi === 'object'
    ? next.gateway.controlUi
    : {}
next.gateway.controlUi.allowedOrigins = [
    `http://127.0.0.1:${gatewayPort}`,
    `http://localhost:${gatewayPort}`,
]

if ('aura-pulse' in next) {
    delete next['aura-pulse']
}

await fs.mkdir(configDir, { recursive: true })
await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`)

console.log(`Configured Aura plugin load path in ${configPath}`)
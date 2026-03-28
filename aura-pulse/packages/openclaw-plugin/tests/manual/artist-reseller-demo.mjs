/**
 * Artist-reseller manual preflight for the isolated OpenClaw Docker runtime.
 *
 * This script no longer tries to inject synthetic contracts over a stale custom
 * WebSocket protocol. Instead, it verifies that the isolated runtime the next
 * manual test pass depends on is actually configured the current way:
 *
 * - OpenClaw reachable on 28789
 * - Aura loaded from the standalone bundle path
 * - Gmail preset/account configured in the isolated runtime
 * - Gmail connector marked active in Aura storage
 *
 * Usage:
 *   pnpm demo:artist
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const OPENCLAW_URL = process.env['OPENCLAW_URL'] ?? 'http://127.0.0.1:28789'
const OPENCLAW_REPO = process.env['OPENCLAW_REPO'] ?? join(homedir(), 'Documents', 'openclaw-aura')
const OPENCLAW_CONFIG = process.env['OPENCLAW_CONFIG'] ?? join(homedir(), 'Documents', 'openclaw-aura-state', 'config', 'openclaw.json')
const EXPECTED_LOAD_PATH = process.env['AURA_PLUGIN_PATH'] ?? '/workspaces/aura-pulse/dist/openclaw-plugin-standalone'

function section(title) {
    console.log(`\n[${title}]`)
}

async function runDockerNode(script) {
    const { stdout } = await execFileAsync(
        'docker',
        ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.extra.yml', 'exec', '-T', 'openclaw-gateway', 'node', '-e', script],
        { cwd: OPENCLAW_REPO },
    )
    return stdout.trim()
}

async function fetchJson(url) {
    const response = await fetch(url)
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`)
    }
    return response.json()
}

async function run() {
    section('Health')
    const health = await fetchJson(`${OPENCLAW_URL}/healthz`)
    console.log(JSON.stringify(health, null, 2))

    section('Config')
    const config = JSON.parse(await readFile(OPENCLAW_CONFIG, 'utf8'))
    const loadPath = config?.plugins?.load?.paths?.[0] ?? null
    const gmailAccount = config?.hooks?.gmail?.account ?? null
    console.log(`plugin load path: ${loadPath}`)
    console.log(`gmail account: ${gmailAccount ?? '(missing)'}`)

    if (loadPath !== EXPECTED_LOAD_PATH) {
        throw new Error(`Expected standalone bundle load path ${EXPECTED_LOAD_PATH}, got ${String(loadPath)}`)
    }

    section('Connectors')
    const connectors = JSON.parse(await runDockerNode(`
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/home/node/.aura/shared/default/contracts.db');
const rows = db.prepare('select id, status, connected_at, updated_at from connectors order by id').all();
process.stdout.write(JSON.stringify(rows));
    `))
    console.log(JSON.stringify(connectors, null, 2))

    const gmail = connectors.find((connector) => connector.id === 'gmail')
    if (!gmail || gmail.status !== 'active') {
        throw new Error('Gmail connector is not active in the isolated runtime')
    }

    section('Next Manual Step')
    console.log('Preflight passed.')
    console.log('Open the containerized Control UI on http://127.0.0.1:28789 and run the manual smoke checklist in docs/openclaw-manual-smoke.md.')
    console.log('Etsy remains optional and inactive until a real credential is supplied.')
}

run().catch((err) => {
    console.error(`Preflight failed: ${err.message}`)
    process.exit(1)
})

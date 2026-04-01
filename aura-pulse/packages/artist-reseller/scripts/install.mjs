#!/usr/bin/env node

/**
 * install.mjs — Expert Store CLI prototype.
 *
 * Reads aurora.manifest.yaml, presents choices, and calls OpenClaw CLI
 * for all configuration. No manual JSON editing.
 *
 * Usage:
 *   node install.mjs [--non-interactive] [--docker] [--dry-run]
 *                    [--agents] [--plugins] [--skills]
 *   node install.mjs --workers listing-drafter,offer-monitor
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(__dirname, '..')
const AGENTS_DIR = join(PACKAGE_DIR, 'agents')
const AURA_PULSE_ROOT = join(PACKAGE_DIR, '..', '..')
const REPO_ROOT = join(PACKAGE_DIR, '..', '..', '..')
const DOCKER_COMPOSE_FILE = join(AURA_PULSE_ROOT, 'docker-compose.openclaw.yml')

const args = process.argv.slice(2)

const dockerDefaults = {
  image: process.env.OPENCLAW_IMAGE || 'ghcr.io/openclaw/openclaw:2026.3.24',
  configDir: process.env.OPENCLAW_CONFIG_DIR || join(AURA_PULSE_ROOT, '.openclaw-docker', 'config'),
  workspaceDir: process.env.OPENCLAW_WORKSPACE_DIR || join(AURA_PULSE_ROOT, '.openclaw-docker', 'workspace'),
  repoDir: process.env.AURA_REPO_DIR || REPO_ROOT,
}

function normalizeOllamaUrl(url) {
  return String(url).replace(/\/+$/, '').replace(/\/v1$/, '')
}

function argVal(name) {
  const eq = args.find(a => a.startsWith(`--${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  const idx = args.indexOf(`--${name}`)
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null
}

const flags = {
  nonInteractive: args.includes('--non-interactive'),
  docker: args.includes('--docker'),
  dryRun: args.includes('--dry-run'),
  workersFlag: argVal('workers'),
  tz: argVal('tz') || Intl.DateTimeFormat().resolvedOptions().timeZone,
  ollamaUrl: normalizeOllamaUrl(argVal('ollama-url') || process.env.OLLAMA_URL || 'http://localhost:11434'),
  ollamaModel: argVal('ollama-model') || process.env.OLLAMA_MODEL || 'qwen3:14b',
  workspaceRoot: argVal('workspace-root')
    || process.env.OPENCLAW_WORKSPACE_DIR
    || (args.includes('--docker') ? dockerDefaults.workspaceDir : null)
    || join(process.env.HOME, '.openclaw/workspace'),
}
const requestedTargets = {
  agents: args.includes('--agents'),
  plugins: args.includes('--plugins'),
  skills: args.includes('--skills'),
}
const targetFilterActive = Object.values(requestedTargets).some(Boolean)
const targets = {
  agents: targetFilterActive ? requestedTargets.agents : true,
  plugins: targetFilterActive ? requestedTargets.plugins : true,
  skills: targetFilterActive ? requestedTargets.skills : true,
}

function log(msg) { console.log(`  ✓ ${msg}`) }
function logDry(msg) { console.log(`  ○ (dry-run) ${msg}`) }
function logErr(msg) { console.log(`  ✗ ${msg}`) }

function shellEscape(value) {
  const text = String(value)
  if (text === '') return "''"
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function ocEnv() {
  if (!flags.docker) return {}
  return {
    OPENCLAW_IMAGE: dockerDefaults.image,
    OPENCLAW_CONFIG_DIR: dockerDefaults.configDir,
    OPENCLAW_WORKSPACE_DIR: dockerDefaults.workspaceDir,
    AURA_REPO_DIR: dockerDefaults.repoDir,
  }
}

function ocPrefixArgs() {
  return flags.docker
    ? ['docker', 'compose', '-f', DOCKER_COMPOSE_FILE, 'exec', '-T', 'openclaw-gateway', 'openclaw']
    : ['openclaw']
}

function dockerComposePrefixArgs() {
  return ['docker', 'compose', '-f', DOCKER_COMPOSE_FILE]
}

function formatCommand(prefixArgs, cmdArgs) {
  const envPrefix = Object.entries(ocEnv())
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(' ')
  const commandText = [...prefixArgs, ...cmdArgs].map(shellEscape).join(' ')
  return envPrefix ? `${envPrefix} ${commandText}` : commandText
}

function runOc(cmdArgs, options = {}) {
  const { inheritStdio = false, retried = false, timeoutMs = 0 } = options
  const command = formatCommand(ocPrefixArgs(), cmdArgs)
  if (flags.dryRun && !inheritStdio) {
    logDry(command)
    return ''
  }
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      stdio: inheritStdio ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...ocEnv() },
      timeout: timeoutMs || undefined,
    })
    return output?.trim?.() || ''
  } catch (e) {
    if (inheritStdio) throw e
    const stderr = e.stderr?.toString().trim()
    const stdout = e.stdout?.toString().trim()
    const message = stderr || stdout || e.message
    const gatewayRestarting = flags.docker && !retried
      && /cannot join network namespace of a non running container|is exited|is restarting|failed to create task for container|OCI runtime create failed|namespace path:/i.test(message)

    if (gatewayRestarting) {
      waitForDockerGateway('automatic gateway restart')
      return runOc(cmdArgs, { inheritStdio, retried: true })
    }

    throw new Error(message)
  }
}

function oc(...cmdArgs) {
  return runOc(cmdArgs)
}

function ocAttemptWithTimeout(timeoutMs, ...cmdArgs) {
  try {
    return { ok: true, output: runOc(cmdArgs, { timeoutMs }) }
  } catch (error) {
    return { ok: false, output: error.message }
  }
}

function ocAttempt(...cmdArgs) {
  return ocAttemptWithTimeout(60_000, ...cmdArgs)
}

function parseJsonOutput(output) {
  try {
    return JSON.parse(output)
  } catch {
    return null
  }
}

function parseSingleLineScalar(value) {
  const trimmed = String(value).trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function resolvePackageDeliverablePath(relativePath, label) {
  const resolvedPath = resolve(PACKAGE_DIR, relativePath)
  const packageRootWithSep = `${PACKAGE_DIR}/`
  if (resolvedPath !== PACKAGE_DIR && !resolvedPath.startsWith(packageRootWithSep)) {
    throw new Error(`${label} must stay inside package root: ${relativePath}`)
  }
  return resolvedPath
}

function runCompose(cmdArgs) {
  const command = formatCommand(dockerComposePrefixArgs(), cmdArgs)
  const output = execSync(command, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...ocEnv() },
  })
  return output?.trim?.() || ''
}

function waitForDockerGateway(reason) {
  if (!flags.docker) return
  if (flags.dryRun) {
    logDry(`Wait for openclaw-gateway after ${reason}`)
    return
  }

  let lastError = null
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      runCompose(['exec', '-T', 'openclaw-gateway', 'openclaw', 'health'])
      log(`Gateway ready after ${reason}`)
      return
    } catch (error) {
      lastError = error
      const message = error.stderr?.toString?.() || error.stdout?.toString?.() || error.message || ''
      if (/service .* is not running|container .* is not running|no container found|cannot exec in a stopped container/i.test(message)) {
        runCompose(['up', '-d', 'openclaw-gateway'])
      }
      execSync('sleep 5')
    }
  }

  throw new Error(`Gateway did not become ready after ${reason}: ${lastError?.message || 'unknown error'}`)
}

function installQmd(qmdPrefix, qmdBinaryPath) {
  const installScript = `mkdir -p "${qmdPrefix}" && npm install --prefix "${qmdPrefix}" @tobilu/qmd && "${qmdBinaryPath}" --version`

  if (flags.dryRun) {
    logDry(installScript)
    return
  }

  if (flags.docker) {
    runCompose(['exec', '-T', 'openclaw-gateway', 'sh', '-lc', installScript])
  } else {
    execSync(installScript, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }

  log(`Installed qmd search backend (${qmdBinaryPath})`)
}

function bootstrapQmdCollection(qmdBinaryPath, memoryDir) {
  const script = `
QMD="${qmdBinaryPath}"
LIST=$("$QMD" collection list 2>/dev/null || true)
case "$LIST" in
  *openclaw-engram*)
    ;;
  *)
    "$QMD" collection add "${memoryDir}" --name openclaw-engram
    ;;
esac
"$QMD" update -c openclaw-engram
  `.trim()

  if (flags.dryRun) {
    logDry(script)
    return
  }

  if (flags.docker) {
    runCompose(['exec', '-T', 'openclaw-gateway', 'sh', '-lc', script])
  } else {
    execSync(script, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  }

  log(`Bootstrapped QMD collection for ${memoryDir}`)
}

function ask(question) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
  })
}

function copyFile(src, dst, label) {
  if (!existsSync(src)) return false
  mkdirSync(dirname(dst), { recursive: true })
  if (existsSync(dst) && label === 'USER.md') {
    return false
  }
  if (flags.dryRun) { logDry(`Copy ${label}`); return true }
  copyFileSync(src, dst)
  return true
}

function syncDirectory(src, dst, label) {
  if (!existsSync(src)) {
    throw new Error(`Missing directory for ${label}: ${src}`)
  }
  if (flags.dryRun) {
    logDry(`Sync ${label}`)
    return true
  }
  mkdirSync(dirname(dst), { recursive: true })
  rmSync(dst, { recursive: true, force: true })
  cpSync(src, dst, { recursive: true })
  return true
}

function removePath(targetPath, label) {
  if (!existsSync(targetPath)) return false
  if (flags.dryRun) {
    logDry(`Remove ${label}`)
    return true
  }
  rmSync(targetPath, { recursive: true, force: true })
  return true
}

function pruneVisibleEntries(dir, keepEntries, label) {
  if (!existsSync(dir)) return
  let removedAny = false
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (keepEntries.has(entry.name)) continue
    const targetPath = join(dir, entry.name)
    removedAny = removePath(targetPath, `${label}/${entry.name}`) || removedAny
  }
  if (removedAny) {
    log(`Pruned stale files from ${label}`)
  }
}

function pruneWorkspaceScaffolding(dir, label, keepVisibleEntries) {
  pruneVisibleEntries(dir, keepVisibleEntries, label)

  const staleEntries = ['.git', '.openclaw']
  let removedAny = false
  for (const entry of staleEntries) {
    removedAny = removePath(join(dir, entry), `${label}/${entry}`) || removedAny
  }
  if (removedAny) {
    log(`Removed OpenClaw scaffolding from ${label}`)
  }
}

function getAgentsConfig() {
  return JSON.parse(oc('config', 'get', 'agents', '--json'))
}

function findAgentIndex(agentsConfig, agentId) {
  const index = agentsConfig.list?.findIndex(agent => agent.id === agentId) ?? -1
  if (index < 0) {
    throw new Error(`Unable to locate agent "${agentId}" in agents.list`)
  }
  return index
}

function unsetConfigIfPresent(path) {
  try {
    oc('config', 'unset', path)
  } catch {
    // Safe to ignore when the path is absent.
  }
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))]
}

function ensureAgentRegistered(agentId, workspace, label) {
  if (flags.dryRun) {
    oc('agents', 'add', agentId, '--workspace', workspace, '--non-interactive')
    log(`Registered ${agentId}${label ? ` (${label})` : ''}`)
    return
  }

  const agentsConfig = getAgentsConfig()
  const existingIndex = agentsConfig.list?.findIndex(agent => agent?.id === agentId) ?? -1
  if (existingIndex >= 0) {
    const existingWorkspace = agentsConfig.list?.[existingIndex]?.workspace
    if (existingWorkspace && existingWorkspace !== workspace) {
      oc('config', 'set', `agents.list[${existingIndex}].workspace`, workspace)
      log(`Reused ${agentId} and reconciled workspace`)
      return
    }
    log(`Reused existing ${agentId}`)
    return
  }

  oc('agents', 'add', agentId, '--workspace', workspace, '--non-interactive')
  log(`Registered ${agentId}${label ? ` (${label})` : ''}`)
}

function isPluginInstalled(pluginId) {
  if (flags.dryRun) return false
  return ocAttempt('plugins', 'inspect', pluginId).ok
}

function getCronJobs() {
  const raw = oc('cron', 'list', '--json')
  const parsed = parseJsonOutput(raw)
  if (Array.isArray(parsed)) return parsed
  return parsed?.jobs || []
}

// --- Parse manifest ---

const manifestText = readFileSync(join(PACKAGE_DIR, 'aurora.manifest.yaml'), 'utf8')
const toolPolicy = JSON.parse(readFileSync(join(PACKAGE_DIR, 'tool-policy.json'), 'utf8'))

const workerBlocks = [...manifestText.matchAll(
  /- id: (\S+)\s+name: (.+)\s+description: (.+)\s+default: (\w+)/g
)]
const availableWorkers = workerBlocks.map(m => ({
  id: m[1],
  name: m[2].trim(),
  description: m[3].trim(),
  default: m[4] === 'true',
}))

const cronBlocks = [...manifestText.matchAll(
  /- id: (\S+)\s+name: (.+)\s+schedule: "(.+)"\s+default: (\w+)\s+session: (\w+)\s+prompt: >\s+([\s\S]*?)(?=\n\s*-\s+id:|\n\w|\n\n\w)/g
)]
const availableCrons = cronBlocks.map(m => ({
  id: m[1],
  name: m[2].trim(),
  schedule: m[3].trim(),
  default: m[4] === 'true',
  session: m[5].trim(),
  prompt: m[6].replace(/\n\s+/g, ' ').trim(),
}))

const domainName = manifestText.match(/^domain:\n  id: \S+\n  name: (.+)$/m)?.[1]?.trim() || 'Unknown'
const mainAgentId = manifestText.match(/^  main:\n    id: (\S+)/m)?.[1] || 'studio-ops'
const orchestratorId = manifestText.match(/^  orchestrator:\n    id: (\S+)/m)?.[1] || 'studio-ops-orchestrator'
const mainAgentDefault = /^  main:\n(?:    .+\n)*?    default: true$/m.test(manifestText)
const identityEmoji = manifestText.match(/emoji: "(.+)"/)?.[1] || ''
const auraPluginInstallPath = flags.docker
  ? '/home/node/.openclaw/extensions/aura-pulse'
  : join(PACKAGE_DIR, '..', 'openclaw-plugin')

if (toolPolicy.defaultAgentId && toolPolicy.defaultAgentId !== mainAgentId) {
  throw new Error(`tool-policy.json defaultAgentId (${toolPolicy.defaultAgentId}) does not match manifest main agent (${mainAgentId})`)
}
if (!mainAgentDefault) {
  throw new Error(`aurora.manifest.yaml must mark the package main agent (${mainAgentId}) with default: true`)
}

function resolveAgentToolAllow(agentId) {
  const policy = toolPolicy.agents?.[agentId]
  const allow = uniqueStrings(policy?.allow)
  if (allow.length === 0) {
    throw new Error(`Missing deterministic tool policy for agent "${agentId}" in tool-policy.json`)
  }
  return allow
}

function getManifestSkills() {
  if (/^skills:\s*\[\s*\]\s*$/m.test(manifestText)) return []
  const section = manifestText.match(/^skills:\n([\s\S]*?)(?=^config:|^para:|^security:)/m)?.[1] || ''
  const skills = []
  let current = null

  for (const line of section.split('\n')) {
    const idMatch = line.match(/^  - id: (\S+)/)
    if (idMatch) {
      if (current?.id && current?.path) skills.push(current)
      current = { id: idMatch[1] }
      continue
    }

    const fieldMatch = line.match(/^    ([a-zA-Z0-9_]+):\s*(.+)$/)
    if (current && fieldMatch) {
      current[fieldMatch[1]] = parseSingleLineScalar(fieldMatch[2])
    }
  }

  if (current?.id && current?.path) skills.push(current)
  return skills
}

const packageSkills = getManifestSkills()

// --- Main ---

async function main() {
  const hostWorkspaceRoot = flags.workspaceRoot
  const hostOpenClawRoot = flags.docker
    ? dockerDefaults.configDir
    : join(process.env.HOME, '.openclaw')
  const hostGlobalSkillsRoot = join(hostOpenClawRoot, 'skills')
  const cliWorkspaceRoot = flags.docker
    ? '/home/node/.openclaw/workspace'
    : hostWorkspaceRoot
  const hostAuraRoot = flags.docker
    ? join(hostWorkspaceRoot, '.aurora')
    : join(process.env.HOME, '.aura')
  const cliAuraRoot = flags.docker
    ? '/home/node/.openclaw/workspace/.aurora'
    : hostAuraRoot
  const hostAuraProjectRoot = join(hostAuraRoot, 'projects', mainAgentId)
  const cliQmdPrefix = join(cliAuraRoot, 'tooling', 'qmd')
  const cliQmdPath = join(cliQmdPrefix, 'node_modules', '.bin', 'qmd')
  const cliEngramMemoryDir = flags.docker
    ? '/home/node/.openclaw/workspace/memory/local'
    : join(cliWorkspaceRoot, 'memory', 'local')

  console.log('')
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║         Aura OS — Expert Package Setup       ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log('')
  console.log(`  Package:  ${domainName}`)
  console.log(`  Agent:    ${mainAgentId} ${identityEmoji}`)
  console.log(`  Timezone: ${flags.tz}`)
  console.log(`  Ollama:   ${flags.ollamaModel} @ ${flags.ollamaUrl}`)
  console.log(`  Targets:  ${Object.entries(targets).filter(([, enabled]) => enabled).map(([name]) => name).join(', ')}`)
  console.log('')

  // --- Step 1: Select workers ---

  let selectedWorkers = []

  if (targets.agents) {
    if (flags.workersFlag) {
      selectedWorkers = flags.workersFlag.split(',').map(id => id.trim())
    } else if (flags.nonInteractive) {
      selectedWorkers = availableWorkers.filter(w => w.default).map(w => w.id)
    } else {
      console.log('  Available sub-agents:\n')
      availableWorkers.forEach((w, i) => {
        const tag = w.default ? ' [recommended]' : ''
        console.log(`    ${i + 1}. ${w.name}${tag}`)
        console.log(`       ${w.description}\n`)
      })
      const defaultNums = availableWorkers.filter(w => w.default).map((_, i) => i + 1).join(',')
      const answer = await ask(`  Select (${defaultNums} or Enter for recommended): `)
      if (!answer) {
        selectedWorkers = availableWorkers.filter(w => w.default).map(w => w.id)
      } else {
        const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1)
        selectedWorkers = indices
          .filter(i => i >= 0 && i < availableWorkers.length)
          .map(i => availableWorkers[i].id)
      }
    }
  }

  const needOrchestrator = selectedWorkers.length > 0
  const agentCommunicationIds = [
    mainAgentId,
    ...(needOrchestrator ? [orchestratorId] : []),
    ...selectedWorkers,
  ]
  console.log('')

  // --- Step 2: Select crons ---

  let selectedCrons = []

  if (targets.agents) {
    if (flags.nonInteractive) {
      selectedCrons = availableCrons.filter(c => c.default)
    } else if (availableCrons.length > 0) {
      console.log('  Scheduled jobs from this package:\n')
      availableCrons.forEach((c, i) => {
        const tag = c.default ? '☑' : '☐'
        console.log(`    ${tag} ${i + 1}. ${c.name} — ${c.schedule}`)
      })
      console.log('')
      const answer = await ask('  Accept recommended? (Y/n): ')
      if (!answer || answer.toLowerCase() === 'y') {
        selectedCrons = availableCrons.filter(c => c.default)
      } else if (answer.toLowerCase() === 'n') {
        selectedCrons = []
      } else {
        const indices = answer.split(',').map(s => parseInt(s.trim(), 10) - 1)
        selectedCrons = indices
          .filter(i => i >= 0 && i < availableCrons.length)
          .map(i => availableCrons[i])
      }
    }
  }

  console.log('')
  console.log('  Installing...\n')

  // --- Step 3: Register agents via OpenClaw CLI ---

  if (targets.agents) {
    ensureAgentRegistered(mainAgentId, cliWorkspaceRoot, 'main agent')

    if (needOrchestrator) {
      const orchWs = `${cliWorkspaceRoot}-orchestrator`
      ensureAgentRegistered(orchestratorId, orchWs)
    }

    for (const workerId of selectedWorkers) {
      const workerWs = `${cliWorkspaceRoot}-${workerId}`
      ensureAgentRegistered(workerId, workerWs)
    }
  }

  // --- Step 4: Copy workspace files ---

  const mainWs = hostWorkspaceRoot
  if (targets.agents) {
    if (!flags.dryRun) mkdirSync(mainWs, { recursive: true })

    const mainFiles = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'BOOTSTRAP.md', 'HEARTBEAT.md']
    for (const file of mainFiles) {
      copyFile(join(AGENTS_DIR, 'main', file), join(mainWs, file), file)
    }
    copyFile(join(PACKAGE_DIR, 'onboarding.yaml'), join(mainWs, 'onboarding.yaml'), 'onboarding.yaml')
    removePath(join(mainWs, 'openclaw-plugin-standalone'), 'legacy main workspace plugin bundle')
    pruneWorkspaceScaffolding(mainWs, 'main workspace', new Set([...mainFiles, 'onboarding.yaml', 'memory']))
    oc('agents', 'set-identity', '--agent', mainAgentId, '--workspace', cliWorkspaceRoot, '--from-identity')
    log('Copied workspace files')

    if (needOrchestrator) {
      const orchWs = `${hostWorkspaceRoot}-orchestrator`
      if (!flags.dryRun) mkdirSync(orchWs, { recursive: true })
      copyFile(join(AGENTS_DIR, 'orchestrator', 'AGENTS.md'), join(orchWs, 'AGENTS.md'), 'orchestrator/AGENTS.md')
      copyFile(join(AGENTS_DIR, 'main', 'TOOLS.md'), join(orchWs, 'TOOLS.md'), 'orchestrator/TOOLS.md')
      pruneWorkspaceScaffolding(orchWs, 'orchestrator workspace', new Set(['AGENTS.md', 'TOOLS.md']))
    }

    for (const workerId of selectedWorkers) {
      const workerWs = `${hostWorkspaceRoot}-${workerId}`
      if (!flags.dryRun) mkdirSync(workerWs, { recursive: true })
      copyFile(join(AGENTS_DIR, 'workers', workerId, 'AGENTS.md'), join(workerWs, 'AGENTS.md'), `${workerId}/AGENTS.md`)
      copyFile(join(AGENTS_DIR, 'main', 'TOOLS.md'), join(workerWs, 'TOOLS.md'), `${workerId}/TOOLS.md`)
      pruneWorkspaceScaffolding(workerWs, `${workerId} workspace`, new Set(['AGENTS.md', 'TOOLS.md']))
    }
  }

  // --- Step 5: Customize BOOTSTRAP.md ---

  const bootstrapDst = join(mainWs, 'BOOTSTRAP.md')
  if (targets.agents && !flags.dryRun && existsSync(bootstrapDst)) {
    let bootstrap = readFileSync(bootstrapDst, 'utf8')

    const workerNames = selectedWorkers
      .map(id => availableWorkers.find(w => w.id === id))
      .filter(Boolean)
      .map(w => `- **${w.name}**: ${w.description}`)
      .join('\n')

    const capSection = selectedWorkers.length > 0
      ? `\n## Your capabilities\n\nThese sub-agents are installed and available:\n\n${workerNames}\n\nMention these when explaining what you can do.\n`
      : '\n## Your capabilities\n\nNo sub-agents installed. You are operating solo.\n'

    const cronNames = selectedCrons
      .map(c => `- **${c.name}** — ${c.schedule}`)
      .join('\n')

    const cronSection = selectedCrons.length > 0
      ? `\nScheduled jobs installed:\n\n${cronNames}\n\nConfirm each with the owner during step 4.\n`
      : '\nNo scheduled jobs installed.\n'

    bootstrap = bootstrap.replace(
      /## 6\. Handoff/,
      capSection + cronSection + '\n## 6. Handoff'
    )
    writeFileSync(bootstrapDst, bootstrap)
    log('Customized BOOTSTRAP.md with installed capabilities')
  }

  // --- Step 6: Install plugins via OpenClaw CLI ---

  if (targets.plugins && flags.docker) {
    if (flags.dryRun) {
      logDry('Use preloaded aura-pulse standalone bundle')
    } else if (isPluginInstalled('aura-pulse')) {
      log('Reused existing aura-pulse plugin')
    } else {
      log('Using preloaded aura-pulse standalone bundle')
    }
  } else if (targets.plugins) {
    if (isPluginInstalled('aura-pulse')) {
      log('Reused existing aura-pulse plugin')
    } else {
      oc('plugins', 'install', auraPluginInstallPath)
      log('Installed aura-pulse plugin (local)')
    }
  }

  if (targets.plugins) {
    if (flags.dryRun || !isPluginInstalled('openclaw-engram')) {
      oc('plugins', 'install', '@joshuaswarren/openclaw-engram', '--pin')
      log('Installed openclaw-engram (memory)')
    } else {
      log('Reused existing openclaw-engram (memory)')
    }
    installQmd(cliQmdPrefix, cliQmdPath)
    bootstrapQmdCollection(cliQmdPath, cliEngramMemoryDir)
    waitForDockerGateway('plugin installation')
  }

  // --- Step 7: Enable plugins ---

  if (targets.plugins) {
    oc('plugins', 'enable', 'aura-pulse')
    oc('plugins', 'enable', 'openclaw-engram')
    oc('plugins', 'enable', 'lobster')
    log('Enabled plugins: aura-pulse, openclaw-engram, lobster')
  }

  // --- Step 8: Configure Engram ---
  //
  // Engram replaces default memory. It needs a model source for
  // extraction (local LLM via Ollama), a search backend, and a
  // capture mode. See: github.com/joshuaswarren/openclaw-engram

  if (targets.plugins) {
    oc('config', 'set', 'plugins.slots.memory', 'openclaw-engram')
    oc('config', 'set', 'plugins.entries.openclaw-engram.enabled', 'true')
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.searchBackend', 'qmd')
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.qmdPath', cliQmdPath)
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.captureMode', 'implicit')
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.localLlmEnabled', 'true')
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.localLlmUrl', flags.ollamaUrl)
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.localLlmModel', flags.ollamaModel)
    oc('config', 'set', 'plugins.entries.openclaw-engram.config.lcmEnabled', 'true')
    log(`Configured Engram (LCM + local LLM: ${flags.ollamaModel} @ ${flags.ollamaUrl})`)
  }

  // --- Step 9: Auth flow via OpenClaw CLI ---
  //
  // Model provider auth (needed for Engram extraction if not using local LLM,
  // and for the main agent's completion provider). Connector auth for Gmail, etc.

  if (targets.plugins && !flags.nonInteractive) {
    console.log('')
    console.log('  Provider authentication:\n')

    const authAnswer = await ask('  Set up model provider auth now? (y/N): ')
    if (authAnswer.toLowerCase() === 'y') {
      console.log('')
      console.log('  Running: openclaw models auth login')
      console.log('  Follow the prompts to authenticate your model provider.\n')
      try {
        runOc(['models', 'auth', 'login', '--set-default'], { inheritStdio: true })
        log('Model provider auth configured')
      } catch {
        logErr('Model auth skipped or failed — run `openclaw models auth login` later')
      }
    } else {
      console.log('  · Skipped model auth (run `openclaw models auth login` later)')
    }

    const connectorSection = manifestText.match(/connectors:\n([\s\S]*?)(?=\n\w)/)?.[1] || ''
    const hasGmail = connectorSection.includes('gmail:')
    if (hasGmail) {
      console.log('')
      const gmailAnswer = await ask('  Set up Gmail connector now? (y/N): ')
      if (gmailAnswer.toLowerCase() === 'y') {
        const gmailAccount = await ask('  Gmail address for the agent: ')
        if (gmailAccount) {
          oc('webhooks', 'gmail', 'setup', '--account', gmailAccount)
          log(`Gmail connector configured for ${gmailAccount}`)
        }
      } else {
        console.log('  · Skipped Gmail (run `openclaw webhooks gmail setup --account <email>` later)')
      }
    }

    console.log('')
  }

  // --- Step 10: Apply remaining config ---

  const allowedPlugins = uniqueStrings(toolPolicy.pluginsAllow)
  const policyAgentIds = uniqueStrings([...Object.keys(toolPolicy.agents || {}), ...agentCommunicationIds])
  const installedAgentPolicies = new Map(policyAgentIds.map(agentId => [agentId, resolveAgentToolAllow(agentId)]))
  if (targets.plugins) {
    oc('config', 'set', 'plugins.allow', JSON.stringify(allowedPlugins))
    oc('config', 'set', 'plugins.entries.aura-pulse.enabled', 'true')
    oc('config', 'set', 'plugins.entries.aura-pulse.config.auraRoot', cliAuraRoot)
    oc('config', 'set', 'plugins.entries.aura-pulse.config.workspaceId', mainAgentId)
    oc('config', 'set', 'plugins.entries.aura-pulse.config.workspaceDir', cliWorkspaceRoot)
    log(`Configured Aura runtime root (${cliAuraRoot})`)
  }

  if (targets.agents) {
    if (flags.dryRun) {
      logDry(`openclaw config set agents.list[<${mainAgentId}-index>].default true`)
      for (const [agentId, allow] of installedAgentPolicies.entries()) {
        logDry(`openclaw config unset agents.list[<${agentId}-index>].tools.profile`)
        logDry(`openclaw config unset agents.list[<${agentId}-index>].tools.alsoAllow`)
        logDry(`openclaw config unset agents.list[<${agentId}-index>].tools.deny`)
        logDry(`openclaw config set agents.list[<${agentId}-index>].tools.allow ${JSON.stringify(allow)}`)
      }
      logDry('openclaw config unset tools.allow')
      logDry('openclaw config unset tools.profile')
      logDry('openclaw config unset tools.alsoAllow')
    } else {
      const agentsConfig = getAgentsConfig()
      for (const [index, agent] of (agentsConfig.list ?? []).entries()) {
        if (agent?.id !== mainAgentId && agent?.default === true) {
          unsetConfigIfPresent(`agents.list[${index}].default`)
        }
      }

      const mainAgentIndex = findAgentIndex(agentsConfig, mainAgentId)
      oc('config', 'set', `agents.list[${mainAgentIndex}].default`, 'true')

      for (const [agentId, allow] of installedAgentPolicies.entries()) {
        if (!agentsConfig.list?.some(agent => agent?.id === agentId)) continue
        const agentIndex = findAgentIndex(agentsConfig, agentId)
        unsetConfigIfPresent(`agents.list[${agentIndex}].tools.profile`)
        unsetConfigIfPresent(`agents.list[${agentIndex}].tools.alsoAllow`)
        unsetConfigIfPresent(`agents.list[${agentIndex}].tools.deny`)
        oc('config', 'set', `agents.list[${agentIndex}].tools.allow`, JSON.stringify(allow))
      }

      unsetConfigIfPresent('tools.allow')
      unsetConfigIfPresent('tools.profile')
      unsetConfigIfPresent('tools.alsoAllow')
    }
    log(`Applied deterministic per-agent tool policies (${agentCommunicationIds.join(', ')})`)

    if (needOrchestrator) {
      oc('config', 'set', 'tools.agentToAgent.enabled', 'true')
      oc('config', 'set', 'tools.agentToAgent.allow', JSON.stringify(agentCommunicationIds))
      log(`Configured agent-to-agent allowlist (${agentCommunicationIds.join(', ')})`)
    } else {
      oc('config', 'set', 'tools.agentToAgent.enabled', 'false')
      try {
        oc('config', 'unset', 'tools.agentToAgent.allow')
      } catch {
        // Safe to ignore if the path does not exist yet.
      }
      log('Disabled agent-to-agent messaging (no sub-agents installed)')
    }

    oc('config', 'set', 'agents.defaults.heartbeat.every', '30m')
    oc('config', 'set', 'agents.defaults.heartbeat.activeHours.start', '08:00')
    oc('config', 'set', 'agents.defaults.heartbeat.activeHours.end', '22:00')
    oc('config', 'set', 'agents.defaults.heartbeat.activeHours.timezone', flags.tz)
    log('Configured heartbeat (every 30m, 8AM–10PM)')

    if (needOrchestrator) {
      oc('config', 'set', 'agents.defaults.subagents.maxSpawnDepth', '2')
      oc('config', 'set', 'agents.defaults.subagents.maxChildrenPerAgent', '5')
      const allowList = JSON.stringify(selectedWorkers)
      if (flags.dryRun) {
        logDry(`openclaw config set agents.list[<orchestrator-index>].subagents.allowAgents ${allowList}`)
      } else {
        const agentsConfig = getAgentsConfig()
        const orchestratorIndex = findAgentIndex(agentsConfig, orchestratorId)
        oc('config', 'set', `agents.list[${orchestratorIndex}].subagents.allowAgents`, allowList)
      }
      log('Configured sub-agent permissions + allowAgents')
    }
  }

  if (targets.plugins || targets.agents) {
    waitForDockerGateway('plugin/config updates')
  }

  // --- Step 11: Install skills via OpenClaw CLI ---

  if (targets.skills) {
    for (const skill of packageSkills) {
      if (skill.scope !== 'global') {
        throw new Error(`Unsupported skill scope "${skill.scope}" for ${skill.id}; only global is supported`)
      }
      const skillSourceDir = resolvePackageDeliverablePath(skill.path, `skill ${skill.id}`)
      if (!existsSync(join(skillSourceDir, 'SKILL.md'))) {
        throw new Error(`Skill "${skill.id}" is missing SKILL.md at ${skillSourceDir}`)
      }
      syncDirectory(skillSourceDir, join(hostGlobalSkillsRoot, skill.id), `global skill ${skill.id}`)
      log(`Installed global skill ${skill.id}`)
    }
  }

  // --- Step 12: Create PARA directories ---

  if (targets.agents) {
    const paraDirs = ['projects', 'projects/builds', 'areas/inventory',
                      'areas/buyer-patterns', 'resources/platform-policies', 'archive', '.trash']
    for (const d of paraDirs) {
      const p = join(hostAuraProjectRoot, d)
      if (!flags.dryRun) mkdirSync(p, { recursive: true })
    }
    log(`Created Aura PARA directories in ${hostAuraProjectRoot}`)
  }

  // --- Step 13: Register cron jobs via OpenClaw CLI ---

  if (targets.agents) {
    if (!flags.dryRun) {
      for (const job of getCronJobs().filter(job => job?.agentId === mainAgentId)) {
        const jobId = job.jobId || job.id
        if (!jobId) continue
        oc('cron', 'rm', jobId)
      }
    }

    for (const cron of selectedCrons) {
      oc('cron', 'add',
        '--name', cron.name,
        '--cron', cron.schedule,
        '--tz', flags.tz,
        '--session', cron.session,
        '--agent', mainAgentId,
        '--message', cron.prompt)
      log(`Added cron: ${cron.name} (${cron.schedule})`)
    }
  }

  // --- Step 14: Verify installation ---

  console.log('')

  if (targets.plugins) {
    const pluginsDoctor = ocAttempt('plugins', 'doctor')
    if (pluginsDoctor.ok && !pluginsDoctor.output.includes('ERROR')) {
      log('Plugin doctor passed')
    } else {
      logErr('Plugin doctor reported issues — run `openclaw plugins doctor` to review')
    }
  }

  if (targets.skills && packageSkills.length > 0) {
    const skillsList = ocAttempt('skills', 'list')
    const missingSkills = packageSkills
      .filter(skill => !skillsList.ok || !skillsList.output.includes(skill.id))
      .map(skill => skill.id)
    if (missingSkills.length === 0) {
      log(`Global skills verified (${packageSkills.map(skill => skill.id).join(', ')})`)
    } else {
      logErr(`Global skills missing from OpenClaw (${missingSkills.join(', ')})`)
    }
  }

  if (targets.plugins) {
    const memorySlot = ocAttempt('config', 'get', 'plugins.slots.memory')
    const searchBackend = ocAttempt('config', 'get', 'plugins.entries.openclaw-engram.config.searchBackend')
    const qmdPath = ocAttempt('config', 'get', 'plugins.entries.openclaw-engram.config.qmdPath')
    const localLlmEnabled = ocAttempt('config', 'get', 'plugins.entries.openclaw-engram.config.localLlmEnabled')
    const lcmEnabled = ocAttempt('config', 'get', 'plugins.entries.openclaw-engram.config.lcmEnabled')
    const engramConfigured = memorySlot.ok
      && searchBackend.ok
      && qmdPath.ok
      && localLlmEnabled.ok
      && lcmEnabled.ok
      && memorySlot.output === 'openclaw-engram'
      && searchBackend.output === 'qmd'
      && qmdPath.output === cliQmdPath
      && localLlmEnabled.output === 'true'
      && lcmEnabled.output === 'true'
    if (engramConfigured) {
      log('Engram config verified')
    } else {
      logErr('Engram config verification failed — review `plugins.entries.openclaw-engram.config`')
    }
  }

  const doctorResult = ocAttempt('doctor', '--non-interactive')
  const healthResult = ocAttempt('health')
  const healthy = doctorResult.ok
    && healthResult.ok
    && !doctorResult.output.includes('ERROR')
    && !healthResult.output.includes('error')
  if (healthy) {
    log('Health check passed')
  } else {
    logErr('Health check had warnings — review with `openclaw doctor`')
  }

  // --- Done ---

  console.log('')
  console.log('╔══════════════════════════════════════════════╗')
  console.log('║                  Setup Complete              ║')
  console.log('╚══════════════════════════════════════════════╝')
  console.log('')
  console.log(`  Targets:      ${Object.entries(targets).filter(([, enabled]) => enabled).map(([name]) => name).join(', ')}`)
  console.log(`  Package:      ${domainName}`)
  if (targets.agents) {
    console.log(`  Main agent:   ${mainAgentId} ${identityEmoji}`)
    if (needOrchestrator) console.log(`  Orchestrator: ${orchestratorId}`)
    if (selectedWorkers.length > 0) console.log(`  Workers:      ${selectedWorkers.join(', ')}`)
    if (selectedCrons.length > 0) console.log(`  Crons:        ${selectedCrons.map(c => c.name).join(', ')}`)
    console.log(`  Heartbeat:    every 30m (${flags.tz})`)
    console.log(`  Workspace:    ${flags.workspaceRoot}`)
    console.log(`  Aura root:    ${hostAuraRoot}`)
  }
  if (targets.plugins) {
    console.log(`  Plugins:      aura-pulse, openclaw-engram, lobster`)
    console.log(`  Memory:       Engram (${flags.ollamaModel} @ ${flags.ollamaUrl})`)
  }
  if (targets.skills && packageSkills.length > 0) console.log(`  Skills:       ${packageSkills.map(skill => `${skill.id} (${skill.scope})`).join(', ')}`)
  console.log('')
  console.log('  Open Pulse to meet Studio Ops.')
  console.log('')
  console.log('  Verify: openclaw agents list --bindings')
  console.log('          openclaw plugins list')
  console.log('          openclaw cron list')
  console.log('')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

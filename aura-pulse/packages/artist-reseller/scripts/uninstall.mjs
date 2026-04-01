#!/usr/bin/env node

/**
 * uninstall.mjs — Remove an Aura OS expert package.
 *
 * Uses OpenClaw CLI for all deregistration and config cleanup.
 * Preserves USER.md, memory/, and PARA directories by default.
 *
 * Usage:
 *   node uninstall.mjs [--include-user-data] [--docker] [--dry-run]
 *                     [--agents] [--plugins] [--skills]
 */

import { readFileSync, rmSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = join(__dirname, '..')
const AURA_PULSE_ROOT = join(PACKAGE_DIR, '..', '..')

const args = process.argv.slice(2)
const flags = {
  docker: args.includes('--docker'),
  dryRun: args.includes('--dry-run'),
  includeUserData: args.includes('--include-user-data'),
  workspaceRoot: args.includes('--workspace-root')
    ? args[args.indexOf('--workspace-root') + 1]
    : process.env.OPENCLAW_WORKSPACE_DIR || join(process.env.HOME, '.openclaw/workspace'),
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

function shellEscape(value) {
  const text = String(value)
  if (text === '') return "''"
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function ocPrefixArgs() {
  return flags.docker
    ? ['docker', 'compose', '-f', join(PACKAGE_DIR, '../../docker-compose.openclaw.yml'), 'exec', '-T', 'openclaw-gateway', 'openclaw']
    : ['openclaw']
}

function formatCommand(cmdArgs) {
  return [...ocPrefixArgs(), ...cmdArgs].map(shellEscape).join(' ')
}

function oc(...cmdArgs) {
  const cmd = formatCommand(cmdArgs)
  if (flags.dryRun) { logDry(cmd); return '' }
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

function unsetConfigIfPresent(path) {
  try {
    oc('config', 'unset', path)
  } catch {
    // Safe to ignore when the path is absent.
  }
}

function getAgentsConfig() {
  return JSON.parse(oc('config', 'get', 'agents', '--json'))
}

function findAgentIndex(agentsConfig, agentId) {
  const index = agentsConfig.list?.findIndex(agent => agent?.id === agentId) ?? -1
  return index
}

function parseSingleLineScalar(value) {
  const trimmed = String(value).trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function removeFile(path, label) {
  if (!existsSync(path)) return
  if (flags.dryRun) { logDry(`Remove ${label}`); return }
  unlinkSync(path)
}

// Parse manifest for agent IDs
const manifestText = readFileSync(join(PACKAGE_DIR, 'aurora.manifest.yaml'), 'utf8')
const toolPolicy = JSON.parse(readFileSync(join(PACKAGE_DIR, 'tool-policy.json'), 'utf8'))
const mainAgentId = manifestText.match(/^  main:\n    id: (\S+)/m)?.[1] || 'studio-ops'
const orchestratorId = manifestText.match(/^  orchestrator:\n    id: (\S+)/m)?.[1] || 'studio-ops-orchestrator'
const workersSection = manifestText.match(/^  workers:\n([\s\S]*?)(?=^connectors:|^heartbeat:|^crons:|^plugins:|^skills:|^config:|^para:|^security:)/m)?.[1] || ''
const workerIds = [...workersSection.matchAll(/^    - id: (\S+)/gm)].map(m => m[1])
const policyAgentIds = Object.keys(toolPolicy.agents || {})
const skillsSection = manifestText.match(/^skills:\n([\s\S]*?)(?=^config:|^para:|^security:)/m)?.[1] || ''
const skillConfigs = []
let currentSkill = null
for (const line of skillsSection.split('\n')) {
  const idMatch = line.match(/^  - id: (\S+)/)
  if (idMatch) {
    if (currentSkill?.id) skillConfigs.push(currentSkill)
    currentSkill = { id: idMatch[1] }
    continue
  }
  const fieldMatch = line.match(/^    ([a-zA-Z0-9_]+):\s*(.+)$/)
  if (currentSkill && fieldMatch) {
    currentSkill[fieldMatch[1]] = parseSingleLineScalar(fieldMatch[2])
  }
}
if (currentSkill?.id) skillConfigs.push(currentSkill)
const openclawRoot = flags.docker
  ? process.env.OPENCLAW_CONFIG_DIR || join(AURA_PULSE_ROOT, '.openclaw-docker', 'config')
  : join(process.env.HOME, '.openclaw')
const globalSkillsRoot = join(openclawRoot, 'skills')

console.log('')
console.log('  Uninstalling...\n')
console.log(`  Targets: ${Object.entries(targets).filter(([, enabled]) => enabled).map(([name]) => name).join(', ')}\n`)

// --- Step 1: Remove cron jobs for this package ---

if (targets.agents) {
  const cronListRaw = oc('cron', 'list', '--json')
  if (cronListRaw) {
    try {
      const cronJobs = JSON.parse(cronListRaw)
      const packageCrons = (Array.isArray(cronJobs) ? cronJobs : cronJobs.jobs || [])
        .filter(j => j.agentId === mainAgentId)
      for (const job of packageCrons) {
        oc('cron', 'rm', job.jobId || job.id)
        log(`Removed cron: ${job.name || job.jobId || job.id}`)
      }
    } catch { /* no cron jobs or parse error */ }
  }
}

// --- Step 2: Deregister agents via OpenClaw CLI ---

if (targets.agents) {
  for (const workerId of workerIds) {
    if (flags.dryRun) {
      oc('agents', 'delete', workerId, '--force')
      log(`Deleted agent: ${workerId}`)
      continue
    }
    try {
      oc('agents', 'delete', workerId, '--force')
      log(`Deleted agent: ${workerId}`)
    } catch {
      // Safe to ignore if agent is already absent.
    }
  }

  for (const agentId of [orchestratorId, mainAgentId]) {
    if (flags.dryRun) {
      oc('agents', 'delete', agentId, '--force')
      log(`Deleted agent: ${agentId}`)
      continue
    }
    try {
      oc('agents', 'delete', agentId, '--force')
      log(`Deleted agent: ${agentId}`)
    } catch {
      // Safe to ignore if agent is already absent.
    }
  }
}

// --- Step 3: Remove workspace files ---

const mainWs = flags.workspaceRoot
if (targets.agents) {
  const filesToRemove = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
                         'BOOTSTRAP.md', 'HEARTBEAT.md', 'onboarding.yaml']
  if (flags.includeUserData) filesToRemove.push('USER.md')

  for (const file of filesToRemove) {
    removeFile(join(mainWs, file), file)
  }
  if (!flags.includeUserData) {
    console.log('  · Kept USER.md (use --include-user-data to remove)')
  }
  log('Removed main workspace files')
}

// --- Step 4: Remove sub-agent workspaces ---

if (targets.agents) {
  const allSubIds = [orchestratorId, ...workerIds]
  for (const agentId of allSubIds) {
    const wsDir = `${flags.workspaceRoot}-${agentId}`
    if (existsSync(wsDir)) {
      if (flags.dryRun) { logDry(`Remove ${wsDir}`) }
      else { rmSync(wsDir, { recursive: true }) }
    }
  }
  log('Removed sub-agent workspaces')
}

// --- Step 5: Disable package plugins ---

if (targets.skills) {
  for (const skill of skillConfigs) {
    if (skill.scope !== 'global') continue
    removeFile(join(globalSkillsRoot, skill.id, 'SKILL.md'), `${skill.id}/SKILL.md`)
    const skillDir = join(globalSkillsRoot, skill.id)
    if (existsSync(skillDir)) {
      if (flags.dryRun) { logDry(`Remove ${skillDir}`) }
      else { rmSync(skillDir, { recursive: true, force: true }) }
    }
  }
  if (skillConfigs.length > 0) {
    log('Removed package-managed global skills')
  }
}

if (targets.plugins) {
  try {
    oc('plugins', 'disable', 'aura-pulse')
  } catch {
    // Safe to ignore if plugin is already disabled.
  }
  try {
    oc('plugins', 'uninstall', 'aura-pulse', '--keep-files')
  } catch {
    // Safe to ignore if plugin is already absent.
  }
  log('Disabled and uninstalled aura-pulse plugin')

  unsetConfigIfPresent('plugins.allow')
  unsetConfigIfPresent('plugins.entries.aura-pulse')
  unsetConfigIfPresent('plugins.slots.memory')
  unsetConfigIfPresent('plugins.entries.openclaw-engram.config')
  log('Cleaned plugin allowlist and Engram config')
}

if (targets.agents) {
  if (!flags.dryRun) {
    const agentsConfig = getAgentsConfig()
    for (const agentId of policyAgentIds) {
      const agentIndex = findAgentIndex(agentsConfig, agentId)
      if (agentIndex < 0) continue
      unsetConfigIfPresent(`agents.list[${agentIndex}].tools.allow`)
      unsetConfigIfPresent(`agents.list[${agentIndex}].tools.profile`)
      unsetConfigIfPresent(`agents.list[${agentIndex}].tools.alsoAllow`)
      unsetConfigIfPresent(`agents.list[${agentIndex}].tools.deny`)
      if (agentId === toolPolicy.defaultAgentId) {
        unsetConfigIfPresent(`agents.list[${agentIndex}].default`)
      }
    }
  }

  unsetConfigIfPresent('tools.allow')
  unsetConfigIfPresent('tools.profile')
  unsetConfigIfPresent('tools.alsoAllow')
  unsetConfigIfPresent('tools.agentToAgent')
  log('Cleaned per-agent tool and agent-to-agent allowlists')
}

// --- Step 7: Clean heartbeat and sub-agent config ---

if (targets.agents) {
  unsetConfigIfPresent('agents.defaults.heartbeat')
  unsetConfigIfPresent('agents.defaults.subagents')
  log('Cleaned heartbeat and sub-agent defaults')
}

// --- Done ---

console.log('')
console.log('  Uninstall complete.')
console.log('  PARA directories preserved.')
console.log('  Engram plugin left installed (memory data preserved).')
console.log('  To fully remove Engram: openclaw plugins uninstall openclaw-engram')
console.log('')
console.log('  Verify: openclaw agents list --bindings')
console.log('          openclaw plugins list')
console.log('          openclaw cron list')
console.log('')

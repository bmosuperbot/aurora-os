/**
 * runtime-api.js — internal barrel for plugin-internal consumers (tests, CLI, tools).
 *
 * Not intended to be part of the public install surface.
 */

export { normalizeConfig }         from './src/config/schema.js'
export { resolvePaths }            from './src/config/paths.js'

export { ContractRuntimeService }  from './src/services/contract-runtime-service.js'
export { WebSocketService }        from './src/services/websocket-service.js'
export { EngramCompletionBridge }  from './src/services/completion-bridge.js'
export { SignalWatcher }           from './src/services/signal-watcher.js'
export { ConnectorManager }        from './src/services/connector-manager.js'
export { FileBridgeWatcher }       from './src/services/file-bridge-watcher.js'

export { jailPath, tryJailPath }   from './src/fs/path-jail.js'
export { applyPatch, applyPatches } from './src/fs/patcher.js'
export { bootstrapPara }           from './src/fs/para.js'
export { touchSignal }             from './src/fs/signal.js'
export { LockManager }             from './src/fs/locks.js'

export { encrypt, decrypt }        from './src/connectors/crypto.js'

export { buildSurfaceDecision }    from './src/tools/aura-surface-decision.js'
export { buildReportToPrimary }    from './src/tools/aura-report-to-primary.js'
export { buildLogAction }          from './src/tools/aura-log-action.js'
export { buildQueryContracts }     from './src/tools/aura-query-contracts.js'
export { buildQueryConnections }   from './src/tools/aura-query-connections.js'
export { buildRequestConnection }  from './src/tools/aura-request-connection.js'
export { buildFsRead }             from './src/tools/aura-fs-read.js'
export { buildFsWrite }            from './src/tools/aura-fs-write.js'
export { buildFsPatch }            from './src/tools/aura-fs-patch.js'
export { buildFsMove }             from './src/tools/aura-fs-move.js'
export { buildFsDelete }           from './src/tools/aura-fs-delete.js'
export { buildFsList }             from './src/tools/aura-fs-list.js'
export { buildFsArchive }          from './src/tools/aura-fs-archive.js'
export { buildFsSearch }           from './src/tools/aura-fs-search.js'

export { buildCli }                from './src/cli/aura-cli.js'

/**
 * api.js — public API surface for dependent packages.
 *
 * Exports the types and utilities that external consumers may need
 * when embedding or extending the Aura Pulse plugin.
 */

export { normalizeConfig }        from './src/config/schema.js'
export { resolvePaths }           from './src/config/paths.js'

export { ContractRuntimeService } from './src/services/contract-runtime-service.js'
export { WebSocketService }       from './src/services/websocket-service.js'
export { EngramCompletionBridge } from './src/services/completion-bridge.js'
export { SignalWatcher }          from './src/services/signal-watcher.js'
export { ConnectorManager }       from './src/services/connector-manager.js'
export { FileBridgeWatcher }      from './src/services/file-bridge-watcher.js'

export { jailPath, tryJailPath }  from './src/fs/path-jail.js'
export { applyPatch, applyPatches } from './src/fs/patcher.js'
export { bootstrapPara }          from './src/fs/para.js'
export { touchSignal }            from './src/fs/signal.js'
export { LockManager }            from './src/fs/locks.js'

export { encrypt, decrypt }       from './src/connectors/crypto.js'

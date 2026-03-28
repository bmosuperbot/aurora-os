/**
 * Normalize and validate raw plugin config from OpenClaw into a typed AuraPluginConfig.
 *
 * @param {Record<string, unknown>} raw
 * @returns {AuraPluginConfig}
 */
export function normalizeConfig(raw) {
    const auraRoot            = typeof raw['auraRoot'] === 'string'            ? raw['auraRoot']            : '~/.aura'
    const workspaceId         = typeof raw['workspaceId'] === 'string'         ? raw['workspaceId']         : 'default'
    const wsPort              = raw['wsPort'] !== undefined ? Number(raw['wsPort']) || 7700 : 7700
    const pulseStaticDir      = typeof raw['pulseStaticDir'] === 'string'      ? raw['pulseStaticDir']      : null
    const signalDebounceMs    = typeof raw['signalDebounceMs'] === 'number'    ? raw['signalDebounceMs']    : 75
    const engramBridgeEnabled = typeof raw['engramBridgeEnabled'] === 'boolean' ? raw['engramBridgeEnabled'] : true
    const engramHttpUrl       = typeof raw['engramHttpUrl'] === 'string'       ? raw['engramHttpUrl']       : 'http://localhost:4318'
    const projectRootOverride = typeof raw['projectRootOverride'] === 'string' ? raw['projectRootOverride'] : null
    const workspaceDir        = typeof raw['workspaceDir'] === 'string'        ? raw['workspaceDir']        : (projectRootOverride ?? process.cwd())
    const bootstrapEnabled    = typeof raw['bootstrapEnabled'] === 'boolean'   ? raw['bootstrapEnabled']    : false
    const openClawConfigPath  = typeof raw['openClawConfigPath'] === 'string'  ? raw['openClawConfigPath']  : null
    const accountIds          = (typeof raw['accountIds'] === 'object' && raw['accountIds'] !== null && !Array.isArray(raw['accountIds']))
        ? /** @type {Record<string, unknown>} */ (raw['accountIds'])
        : {}
    const rawTtl             = (typeof raw['ttl'] === 'object' && raw['ttl'] !== null && !Array.isArray(raw['ttl']))
        ? /** @type {Record<string, unknown>} */ (raw['ttl'])
        : {}

    return {
        auraRoot,
        workspaceId,
        wsPort,
        pulseStaticDir,
        signalDebounceMs,
        engramBridgeEnabled,
        engramHttpUrl,
        projectRootOverride,
        workspaceDir,
        bootstrapEnabled,
        openClawConfigPath,
        accountIds,
        ttl: {
            checkIntervalMs: typeof rawTtl['checkIntervalMs'] === 'number' ? rawTtl['checkIntervalMs'] : 60_000,
            resolverTimeoutMs: typeof rawTtl['resolverTimeoutMs'] === 'number' ? rawTtl['resolverTimeoutMs'] : 600_000,
            completeRetentionDays: typeof rawTtl['completeRetentionDays'] === 'number' ? rawTtl['completeRetentionDays'] : 30,
            failedRetentionDays: typeof rawTtl['failedRetentionDays'] === 'number' ? rawTtl['failedRetentionDays'] : 7,
        },
    }
}

/**
 * @typedef {object} AuraPluginConfig
 * @property {string}                  auraRoot
 * @property {string}                  workspaceId
 * @property {number}                  wsPort
 * @property {string|null}             pulseStaticDir
 * @property {number}                  signalDebounceMs
 * @property {boolean}                 engramBridgeEnabled
 * @property {string}                  engramHttpUrl
 * @property {string|null}             projectRootOverride
 * @property {string}                  workspaceDir
 * @property {boolean}                 bootstrapEnabled
 * @property {string|null}             openClawConfigPath
 * @property {Record<string, unknown>} accountIds
 * @property {{
 *   checkIntervalMs: number,
 *   resolverTimeoutMs: number,
 *   completeRetentionDays: number,
 *   failedRetentionDays: number,
 * }} ttl
 */

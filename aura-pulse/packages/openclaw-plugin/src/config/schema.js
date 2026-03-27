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

    return {
        auraRoot,
        workspaceId,
        wsPort,
        pulseStaticDir,
        signalDebounceMs,
        engramBridgeEnabled,
        engramHttpUrl,
        projectRootOverride,
    }
}

/**
 * @typedef {object} AuraPluginConfig
 * @property {string}      auraRoot
 * @property {string}      workspaceId
 * @property {number}      wsPort
 * @property {string|null} pulseStaticDir
 * @property {number}      signalDebounceMs
 * @property {boolean}     engramBridgeEnabled
 * @property {string}      engramHttpUrl
 * @property {string|null} projectRootOverride
 */

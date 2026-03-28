export interface AuraPluginConfig {
    auraRoot: string;
    workspaceId: string;
    wsPort: number;
    pulseStaticDir: string | null;
    signalDebounceMs: number;
    engramBridgeEnabled: boolean;
    engramHttpUrl: string;
    projectRootOverride: string | null;
    workspaceDir: string;
    bootstrapEnabled: boolean;
    openClawConfigPath: string | null;
    /** Named account identifiers, keyed by service (e.g. { gmail: "studio-ops@gmail.com" }) */
    accountIds: Record<string, unknown>;
    ttl: {
        checkIntervalMs: number;
        resolverTimeoutMs: number;
        completeRetentionDays: number;
        failedRetentionDays: number;
    };
}

export function normalizeConfig(raw: Record<string, unknown>): AuraPluginConfig;

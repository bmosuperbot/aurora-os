export interface AuraPluginConfig {
    auraRoot: string;
    workspaceId: string;
    wsPort: number;
    pulseStaticDir: string | null;
    signalDebounceMs: number;
    engramBridgeEnabled: boolean;
    engramHttpUrl: string;
    projectRootOverride: string | null;
}

export function normalizeConfig(raw: Record<string, unknown>): AuraPluginConfig;

import type { AuraPluginConfig } from '../config/schema.js';
import type { ContractRuntime, ConnectorState, ExecutionNotifier, SQLiteContractStorage } from '@aura/contract-runtime';
import type { PluginLogger } from '../types/plugin-types.js';

export interface OnboardingStatusItem {
    id: string;
    label: string;
    status: 'installed' | 'missing' | 'not-installed' | 'pending';
    tier: 'required' | 'optional';
}

export interface OnboardingStatus {
    items: OnboardingStatusItem[];
    incomplete: boolean;
}

export interface KernelSurfacePayload {
    surfaceId: string;
    title?: string;
    summary?: string;
    voiceLine?: string;
    surfaceType?: 'workspace' | 'plan' | 'attention' | 'monitor' | 'brief';
    priority?: 'low' | 'normal' | 'high';
    collaborative?: boolean;
    icon?: string;
    a2uiMessages?: unknown[];
}

export interface CommandRelay {
    dispatch(params: {
        commandId: string;
        text: string;
        modality: 'text' | 'voice';
    }): Promise<{
        sessionKey: string;
        message: string;
    }>;
    dispatchSurfaceAction(params: {
        surfaceId: string;
        actionName: string;
        sourceComponentId?: string;
        context?: Record<string, unknown>;
    }): Promise<{
        sessionKey: string;
        message: string;
    }>;
}

export interface ConnectorCardPayload {
    id: string;
    source: ConnectorState['source'];
    status: ConnectorState['status'];
    offered_at?: string;
    never_resurface?: boolean;
    capability_without: string;
    capability_with: string;
    connector_id: string;
    connector_name: string;
    offer_text: string;
    flow_type?: 'browser_redirect' | 'secure_input' | 'manual_guide';
    auth_url?: string;
    input_label?: string;
    guide_steps?: string[];
}

export class WebSocketService {
    constructor(
        config: AuraPluginConfig,
        runtime: ContractRuntime,
        storage: SQLiteContractStorage,
        signalPath: string,
        logger: PluginLogger,
        onboardingStatus?: OnboardingStatus | null,
        executor?: ExecutionNotifier | null,
        commandRelay?: CommandRelay | null,
    );
    start(): Promise<void>;
    stop(): Promise<void>;
    nudge(): void;
    pushConnectorRequest(connector: ConnectorCardPayload): void;
    pushConnectorComplete(connectorId: string, status: string): void;
    pushKernelSurface(surface: KernelSurfacePayload): void;
    clearKernelSurface(surfaceId: string): void;
    broadcast(message: object): void;
}

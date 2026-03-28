export interface ConnectorState {
    id: string;
    source: 'openclaw-channel' | 'aura-connector' | 'aura-skill' | 'aura-app';
    // aura-app TODO(phase-5): pm2 or docker process managed app.
    // Reference implementation: posh-pusher pattern.
    // Agent scaffolds; Aura manages lifecycle via exec tool.
    status: 'active' | 'pending' | 'declined' | 'error' | 'not-offered';
    offered_at?: string;
    connected_at?: string;
    declined_at?: string;
    declined_reason?: string;
    never_resurface?: boolean;
    resurface_trigger?: string;
    capability_without: string;
    capability_with: string;
    oauth_token_enc?: string;
    refresh_token_enc?: string;
    expires_at?: string;
    app_pid?: number | string;
    app_health_url?: string;
    app_start_cmd?: string;
    app_restart_count?: number;
    updated_at: string;
}

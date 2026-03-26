export interface ConnectorState {
    id: string;
    source: 'openclaw-channel' | 'aura-connector';
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
    updated_at: string;
}

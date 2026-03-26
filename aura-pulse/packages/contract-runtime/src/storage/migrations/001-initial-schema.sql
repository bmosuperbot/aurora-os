-- Core contract state
CREATE TABLE IF NOT EXISTS contracts (
    id             TEXT PRIMARY KEY,
    version        TEXT NOT NULL,
    type           TEXT NOT NULL,
    status         TEXT NOT NULL,
    resolver_type  TEXT NOT NULL CHECK (resolver_type IN ('human', 'agent')),
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL,
    expires_at     TEXT,
    surface_after  TEXT,
    parent_id      TEXT,
    recovery_of    TEXT,
    payload        JSON NOT NULL
);

-- Append-only audit log (separate table — don't bloat contracts rows)
CREATE TABLE IF NOT EXISTS contract_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id  TEXT NOT NULL,
    timestamp    TEXT NOT NULL,
    participant  TEXT NOT NULL,
    event        TEXT NOT NULL,
    detail       JSON,
    FOREIGN KEY (contract_id) REFERENCES contracts(id)
);

-- Autonomous action log (pre-authorized actions below approval threshold)
CREATE TABLE IF NOT EXISTS autonomous_log (
    id             TEXT PRIMARY KEY,
    timestamp      TEXT NOT NULL,
    agent_id       TEXT NOT NULL,
    package        TEXT NOT NULL,
    action         TEXT NOT NULL,
    summary        TEXT NOT NULL,
    detail         JSON,
    contract_id    TEXT,
    connector_used TEXT NOT NULL
);

-- Connector credential state
CREATE TABLE IF NOT EXISTS connectors (
    id                  TEXT PRIMARY KEY,
    source              TEXT NOT NULL,
    status              TEXT NOT NULL,
    offered_at          TEXT,
    connected_at        TEXT,
    declined_at         TEXT,
    declined_reason     TEXT,
    never_resurface     INTEGER NOT NULL DEFAULT 0,
    resurface_trigger   TEXT,
    capability_without  TEXT,
    capability_with     TEXT,
    oauth_token_enc     TEXT,
    refresh_token_enc   TEXT,
    expires_at          TEXT,
    updated_at          TEXT NOT NULL
);

-- Single-use resume tokens
CREATE TABLE IF NOT EXISTS resume_tokens (
    contract_id  TEXT NOT NULL,
    token        TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    PRIMARY KEY (contract_id, token)
);

-- Ephemeral file locks (table declared now, used Phase 4)
CREATE TABLE IF NOT EXISTS file_locks (
    path             TEXT PRIMARY KEY,
    locked_by_agent  TEXT NOT NULL,
    locked_at        TEXT NOT NULL,
    lock_expires_at  TEXT NOT NULL,
    operation        TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status         ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_resolver_type  ON contracts(resolver_type);
CREATE INDEX IF NOT EXISTS idx_contracts_parent_id      ON contracts(parent_id);
CREATE INDEX IF NOT EXISTS idx_contracts_surface_after  ON contracts(surface_after);
CREATE INDEX IF NOT EXISTS idx_contracts_updated_at     ON contracts(updated_at);
CREATE INDEX IF NOT EXISTS idx_contracts_expires_at     ON contracts(expires_at);
CREATE INDEX IF NOT EXISTS idx_contract_log_cid         ON contract_log(contract_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_log_agent     ON autonomous_log(agent_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_resume_tokens_expires    ON resume_tokens(expires_at);

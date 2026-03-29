// Minimal type stubs for the OpenClaw plugin SDK.
// These are only used for development-time type checking.
// At runtime, OpenClaw provides the real implementations via its module resolution.
// Signatures mirror the actual openclaw@2026.3.24 types.d.ts where they intersect.

export interface PluginLogger {
    /** debug is optional in the real SDK */
    debug?(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

export interface PluginRuntimeAgentSessionEntry {
    sessionId: string;
    updatedAt: number;
    [key: string]: unknown;
}

export interface PluginRuntimeAgentSessionStore {
    [sessionKey: string]: PluginRuntimeAgentSessionEntry | undefined;
}

export interface RunEmbeddedPiAgentParams {
    sessionId: string;
    sessionKey?: string;
    agentId?: string;
    messageProvider?: string;
    trigger?: 'cron' | 'heartbeat' | 'manual' | 'memory' | 'overflow' | 'user';
    senderIsOwner?: boolean;
    sessionFile: string;
    workspaceDir: string;
    agentDir?: string;
    config?: Record<string, unknown>;
    prompt: string;
    provider?: string;
    model?: string;
    authProfileId?: string;
    authProfileIdSource?: 'auto' | 'user';
    thinkLevel?: string;
    disableTools?: boolean;
    timeoutMs: number;
    runId: string;
    extraSystemPrompt?: string;
    streamParams?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface PluginRuntimeAgent {
    defaults: {
        provider: string;
        model: string;
    };
    /** Accepts additional args the real SDK passes (agentId, env, etc.). */
    resolveAgentDir(...args: unknown[]): string;
    resolveAgentWorkspaceDir(...args: unknown[]): string;
    resolveAgentIdentity(...args: unknown[]): { name?: string } | null | undefined;
    resolveThinkingDefault(params: { cfg: Record<string, unknown>; provider: string; model: string }): string | undefined;
    runEmbeddedPiAgent(params: RunEmbeddedPiAgentParams): Promise<unknown>;
    resolveAgentTimeoutMs(params: { cfg?: Record<string, unknown> }): number;
    ensureAgentWorkspace(params: { dir: string }): Promise<void>;
    session: {
        resolveStorePath(store: unknown, options: { agentId: string }): string;
        loadSessionStore(storePath: string): PluginRuntimeAgentSessionStore;
        saveSessionStore(storePath: string, store: PluginRuntimeAgentSessionStore): Promise<void>;
        resolveSessionFilePath(
            sessionId: string,
            entry: PluginRuntimeAgentSessionEntry,
            options: { agentId: string },
        ): string;
    };
}

export interface PluginRuntime {
    state: { resolveStateDir(): string };
    agent: PluginRuntimeAgent;
    config?: {
        loadConfig(): Promise<Record<string, unknown>>;
    };
    system?: {
        enqueueSystemEvent(text: string, options: { sessionKey: string }): Promise<void>;
        requestHeartbeatNow(options: { sessionKey: string; reason: string }): void;
        runHeartbeatOnce?(options?: {
            reason?: string;
            agentId?: string;
            sessionKey?: string;
            heartbeat?: { target?: string };
        }): Promise<unknown>;
    };
    subagent?: {
        run(options: { sessionKey: string; prompt: string; deliver?: boolean }): Promise<unknown>;
    };
}

export interface OpenClawConfig {
    [key: string]: unknown;
}

export interface ToolResult {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

export interface RegisteredTool {
    name: string;
    description: string;
    parameters: unknown;
    execute(id: string, params: Record<string, unknown>): Promise<ToolResult>;
}

/** Mirrors OpenClawPluginServiceContext from the real SDK. */
export interface OpenClawPluginServiceContext {
    config: OpenClawConfig;
    workspaceDir?: string;
    stateDir: string;
    logger: PluginLogger;
}

/** Mirrors OpenClawPluginService from the real SDK. */
export interface RegisteredService {
    id: string;
    start(ctx: OpenClawPluginServiceContext): void | Promise<void>;
    stop?(ctx: OpenClawPluginServiceContext): void | Promise<void>;
}

export interface RegisteredHttpRoute {
    path: string;
    auth: 'none' | 'plugin' | 'user';
    match: 'exact' | 'prefix';
    handler(req: unknown, res: unknown): void | Promise<void>;
}

/** Minimal subset of Commander's Command needed for CLI registration. */
export interface OpenClawCommandBuilder {
    description(desc: string): this;
    allowUnknownOption(): this;
    argument(spec: string, description?: string): this;
    action(handler: (...args: unknown[]) => void | Promise<void>): this;
}

/** Mirrors OpenClawPluginCliContext from the real SDK. */
export interface OpenClawPluginCliContext {
    program: { command(name: string): OpenClawCommandBuilder };
    config: OpenClawConfig;
    logger: PluginLogger;
}

/** Mirrors OpenClawPluginCliRegistrar — a function that wires commands onto program. */
export type RegisteredCli = (ctx: OpenClawPluginCliContext) => void | Promise<void>;

export interface OpenClawPluginApi {
    id: string;
    name: string;
    version?: string;
    description?: string;
    config: OpenClawConfig;
    /** Optional in the real SDK — not always provided depending on registrationMode. */
    pluginConfig?: Record<string, unknown>;
    runtime: PluginRuntime;
    logger: PluginLogger;
    registrationMode: 'full' | 'setup-only' | 'setup-runtime';
    resolvePath(input: string): string;
    registerTool(tool: RegisteredTool, opts?: { optional?: boolean }): void;
    registerService(service: RegisteredService): void;
    registerHttpRoute(params: RegisteredHttpRoute): void;
    registerCli(registrar: RegisteredCli, opts?: Record<string, unknown>): void;
    registerHook(event: string, handler: (event: unknown) => unknown): void;
}

export interface PluginRuntimeStore<T> {
    setRuntime(runtime: T): void;
    getRuntime(): T;
    tryGetRuntime(): T | null;
    clearRuntime(): void;
}

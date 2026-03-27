declare module 'openclaw/plugin-sdk/plugin-entry' {
    export function definePluginEntry(options: {
        id: string;
        name: string;
        description: string;
        kind?: OpenClawPluginDefinition['kind'];
        configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
        register: (api: OpenClawPluginApi) => void | Promise<void>;
    }): {
        id: string;
        name: string;
        description: string;
        configSchema: OpenClawPluginConfigSchema;
        register: NonNullable<OpenClawPluginDefinition['register']>;
    } & Pick<OpenClawPluginDefinition, 'kind'>
}
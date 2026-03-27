type AuraRuntimeConfig = typeof globalThis & {
  __AURA_PLUGIN_URL__?: string;
  __AURA_WS_URL__?: string;
};

const DEFAULT_PLUGIN_URL = "http://localhost:7701";
const DEFAULT_WS_URL = "ws://localhost:7700/aura/surface";

function getRuntimeConfig(): AuraRuntimeConfig {
  return globalThis as AuraRuntimeConfig;
}

export function getPluginHttpUrl(): string {
  return getRuntimeConfig().__AURA_PLUGIN_URL__ ?? import.meta.env.VITE_PLUGIN_URL ?? DEFAULT_PLUGIN_URL;
}

export function getPluginWsUrl(): string {
  const configuredWs = getRuntimeConfig().__AURA_WS_URL__;
  if (configuredWs) return configuredWs;

  const pluginUrl = getPluginHttpUrl();
  if (pluginUrl === DEFAULT_PLUGIN_URL) {
    return DEFAULT_WS_URL;
  }

  const url = new URL(pluginUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/aura/surface";
  return url.toString();
}
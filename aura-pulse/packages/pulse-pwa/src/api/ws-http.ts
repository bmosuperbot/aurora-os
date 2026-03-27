// API client for plugin HTTP routes (history, TTS proxy, etc.)
// All calls go to the plugin's HTTP server at wsPort+1 (default 7701).
import { getPluginHttpUrl } from "./plugin-config.js";

export interface HistoryResponse {
  contracts: HistoryContract[];
  hasMore: boolean;
  total: number;
}

export interface HistoryContract {
  id: string;
  type: string;
  status: "complete" | "failed";
  agent_name?: string;
  intent: { goal: string; context?: string };
  clarifications: Array<{ id: string; role: string; text?: string; content?: string; timestamp: string }>;
  resume?: {
    action: string;
    resolver_id: string;
    timestamp: string;
    artifacts?: Record<string, unknown>;
  };
  completion_surface?: { voice_line: string; summary: string };
  created_at: string;
  updated_at: string;
}

export async function fetchHistory(
  limit = 50,
  offset = 0,
  type?: string
): Promise<HistoryResponse> {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (type) params.set("type", type);
  const res = await fetch(`${getPluginHttpUrl()}/aura/history?${params}`);
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`);
  return res.json() as Promise<HistoryResponse>;
}

import { useEffect, useRef, useState, useCallback } from "react";

import type { PulseWebSocketTransport } from "../ws/client.js";
import type { RuntimeMessage } from "../ws/protocol.js";
import { useSurfaceStore } from "../ws/surface-store.js";
import { AuroraBarsLoading, AuroraBarsListen } from "../assets/aurora-bars.js";

const WORKSPACE_COMMAND_EVENT = "aura:queue-command";
const MAX_TIMELINE_ENTRIES = 18;

interface CommandTimelineEntry {
  id: string;
  role: "user" | "system" | "agent";
  text: string;
  status?: "pending" | "accepted" | "rejected";
  modality?: "text" | "voice";
  timestamp: string;
}

interface BrowserSpeechRecognitionResult { transcript: string; }
interface BrowserSpeechRecognitionResultList { length: number; [index: number]: { length: number; [innerIndex: number]: BrowserSpeechRecognitionResult }; }
interface BrowserSpeechRecognitionEvent { results: BrowserSpeechRecognitionResultList; }
interface BrowserSpeechRecognition { continuous: boolean; interimResults: boolean; lang: string; onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void; }
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const sw = window as Window & { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor; };
  return sw.SpeechRecognition ?? sw.webkitSpeechRecognition ?? null;
}

function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && typeof window.speechSynthesis !== "undefined";
}

function createCommandId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function trimEntries(entries: CommandTimelineEntry[]): CommandTimelineEntry[] {
  return entries.slice(-MAX_TIMELINE_ENTRIES);
}

const TIMELINE_STORAGE_KEY = "aura.command-timeline";

function loadPersistedEntries(): CommandTimelineEntry[] {
  try {
    const raw = sessionStorage.getItem(TIMELINE_STORAGE_KEY);
    if (!raw) return [];
    const entries: CommandTimelineEntry[] = JSON.parse(raw);
    // Clear stale "pending" status from a previous session
    return entries.map((e) => e.status === "pending" ? { ...e, status: "accepted" as const } : e);
  } catch { return []; }
}

function persistEntries(entries: CommandTimelineEntry[]): void {
  try { sessionStorage.setItem(TIMELINE_STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
}

/* ── SVG Icons ─────────────────────────────────────────────────────────── */
const IconSend = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 1.5l-6 13-2.5-5.5L.5 6.5z" /><path d="M14.5 1.5L6 9" />
  </svg>
);
const IconMic = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="5.5" y="1" width="5" height="9" rx="2.5" /><path d="M3 7a5 5 0 0010 0" /><path d="M8 12v3" />
  </svg>
);
const IconSpeaker = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 5.5h2.5L8 2.5v11L4.5 10.5H2a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5z" />
    <path d="M10 5.5c.8.7 1.3 1.7 1.3 2.5s-.5 1.8-1.3 2.5" />
    <path d="M12 3.5c1.3 1.2 2 2.8 2 4.5s-.7 3.3-2 4.5" />
  </svg>
);
const IconSpeakerOff = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <path d="M2 5.5h2.5L8 2.5v11L4.5 10.5H2a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5z" />
    <path d="M11 5.5l3 5M14 5.5l-3 5" />
  </svg>
);
const IconChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6l4 4 4-4"/></svg>
);
const IconChevronUp = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10l4-4 4 4"/></svg>
);

/* ── Processing dots ───────────────────────────────────────────────────── */
const ProcessingDots = () => (
  <span className="command-pill__dots" aria-label="Processing">
    <span /><span /><span />
  </span>
);

/* ═══════════════════════════════════════════════════════════════════════════
   CommandDock — floating pill
   ═══════════════════════════════════════════════════════════════════════════ */

interface CommandDockProps {
  wsClient: PulseWebSocketTransport;
}

export function CommandDock({ wsClient }: CommandDockProps) {
  const wsStatus = useSurfaceStore((s) => s.wsStatus);
  const setAgentBusy = useSurfaceStore((s) => s.setAgentBusy);
  const ttsEnabled = useSurfaceStore((s) => s.ttsEnabled);
  const setTtsEnabled = useSurfaceStore((s) => s.setTtsEnabled);

  const [entries, setEntries] = useState<CommandTimelineEntry[]>(loadPersistedEntries);
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(() => loadPersistedEntries().length > 0);
  const [hidden, setHidden] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const agentBusy = useSurfaceStore((s) => s.agentBusy);
  const ttsRef = useRef(ttsEnabled);
  ttsRef.current = ttsEnabled;

  // Auto-scroll timeline when entries change or agent starts/stops processing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries, agentBusy]);

  // Persist timeline to sessionStorage
  useEffect(() => { persistEntries(entries); }, [entries]);

  // Cleanup speech recognition + synthesis
  useEffect(() => () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (hasSpeechSynthesis()) window.speechSynthesis.cancel();
  }, []);

  const speakText = useCallback((line: string) => {
    if (!hasSpeechSynthesis() || !ttsRef.current) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(line);
    utter.rate = 1.05;
    utter.pitch = 0.95;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, []);

  // Publish speaking state to the store for topbar aurora animation
  useEffect(() => {
    useSurfaceStore.setState({ agentBusy: speaking ? false : useSurfaceStore.getState().agentBusy });
  }, [speaking]);

  const queueCommand = useCallback((rawText: string, modality: "text" | "voice" = "text") => {
    const command = rawText.trim();
    if (!command) return;
    const commandId = createCommandId();
    const timestamp = new Date().toISOString();

    if (wsStatus !== "connected") {
      setEntries((cur) => trimEntries([
        ...cur,
        { id: commandId, role: "user", text: command, modality, status: "rejected", timestamp },
        { id: `${commandId}:status`, role: "system", text: "Aura is offline. Reconnect first.", status: "rejected", timestamp },
      ]));
      return;
    }

    setEntries((cur) => trimEntries([...cur, { id: commandId, role: "user", text: command, modality, status: "pending", timestamp }]));
    setAgentBusy(true);
    wsClient.send({ type: "submit_command", commandId, text: command, modality });
    if (!expanded) setExpanded(true);
  }, [wsStatus, wsClient, expanded, setAgentBusy]);

  // Listen for command status updates
  useEffect(() => wsClient.onMessage((message: RuntimeMessage) => {
    if (message.type === "command_status") {
      setEntries((cur) => {
        const next = cur.map((e) => (e.id === message.commandId && e.role === "user" ? { ...e, status: message.status } : e));
        const statusId = `${message.commandId}:status`;
        if (message.status === "rejected") {
          setAgentBusy(false);
          const statusEntry: CommandTimelineEntry = { id: statusId, role: "system", text: message.message, status: "rejected", timestamp: new Date().toISOString() };
          const idx = next.findIndex((e) => e.id === statusId);
          if (idx === -1) next.push(statusEntry); else next.splice(idx, 1, statusEntry);
        }
        return trimEntries(next);
      });
      return;
    }

    // When a kernel surface arrives with a voiceLine, inject it into the timeline.
    // Skip if the most recent agent entry for this surface has the exact same text (true duplicate).
    // Different text on the same surface = legitimate new message (e.g. action callback response).
    if (message.type === "kernel_surface" && message.surface.voiceLine) {
      const line = message.surface.voiceLine;
      const sid = message.surface.surfaceId;
      setEntries((cur) => {
        const lastForSurface = [...cur].reverse().find((e) => e.role === "agent" && e.id.startsWith(`voice-${sid}-`));
        if (lastForSurface && lastForSurface.text === line) return cur;
        return trimEntries([...cur, { id: `voice-${sid}-${Date.now()}`, role: "agent", text: line, timestamp: new Date().toISOString() }]);
      });
      speakText(line);
      if (!expanded) setExpanded(true);
    }
  }), [wsClient, speakText, expanded, setAgentBusy]);

  // Listen for workspace-queued commands
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text?: string; modality?: "text" | "voice" }>).detail;
      if (detail?.text) queueCommand(detail.text, detail.modality === "voice" ? "voice" : "text");
    };
    window.addEventListener(WORKSPACE_COMMAND_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_COMMAND_EVENT, handler);
  }, [queueCommand]);

  const handleSubmit = () => {
    const cmd = text.trim();
    if (!cmd) return;
    // Slash commands: send to agent AND clear the local chat timeline
    if (cmd.startsWith("/")) {
      queueCommand(cmd, "text");
      setText("");
      setTimeout(() => {
        setEntries([]);
        setExpanded(false);
        persistEntries([]);
        setAgentBusy(false);
      }, 150);
      return;
    }
    queueCommand(cmd, "text");
    setText("");
  };

  const toggleVoice = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new Ctor();
    let transcript = "";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      transcript = Array.from({ length: event.results.length }, (_, i) => event.results[i]?.[0]?.transcript ?? "").join(" ").trim();
      setText(transcript);
    };
    recognition.onerror = () => { setListening(false); recognitionRef.current = null; };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (transcript.trim()) queueCommand(transcript, "voice");
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  // Hidden state — show a small summon dot
  if (hidden) {
    return (
      <button className="command-pill__summon" onClick={() => setHidden(false)} aria-label="Show command input">
        <div className="pulse-dot" style={{ width: 8, height: 8 }} />
      </button>
    );
  }

  const pillClass = ["command-pill", expanded && "command-pill--expanded"].filter(Boolean).join(" ");

  return (
    <div className={pillClass} aria-label="Aura command input">
      {/* Timeline */}
      <div className="command-pill__timeline" ref={scrollRef}>
        {(entries.length > 0 || agentBusy) && (
          <div className="command-pill__timeline-inner">
            {entries.map((entry) => (
              <article key={entry.id} className={`command-pill__entry command-pill__entry--${entry.role}`}>
                <div className="command-pill__entry-meta">
                  <span>{entry.role === "user" ? "You" : "Aurora"}</span>
                  {entry.status === "rejected" && (
                    <span className="command-pill__status--rejected">failed</span>
                  )}
                </div>
                <p className="command-pill__entry-text">{entry.text}</p>
              </article>
            ))}
            {agentBusy && (
              <article className="command-pill__entry command-pill__entry--agent">
                <div className="command-pill__entry-meta">
                  <span>Aurora</span>
                  <ProcessingDots />
                </div>
              </article>
            )}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="command-pill__input-row">
        {/* State indicator */}
        {listening ? (
          <AuroraBarsListen width={28} style={{ flexShrink: 0 }} />
        ) : agentBusy ? (
          <AuroraBarsLoading width={28} style={{ flexShrink: 0 }} />
        ) : null}

        <input
          ref={inputRef}
          className="command-pill__input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          onFocus={() => { if (entries.length > 0) setExpanded(true); }}
          placeholder={listening ? "Listening..." : "Tell Aura what to do..."}
        />

        {hasSpeechSynthesis() && (
          <button
            className="command-pill__toggle"
            onClick={() => { setTtsEnabled(!ttsEnabled); if (ttsEnabled && speaking) { window.speechSynthesis.cancel(); setSpeaking(false); } }}
            aria-label={ttsEnabled ? "Mute voice" : "Enable voice"}
            title={ttsEnabled ? "Voice on" : "Voice off"}
            style={ttsEnabled ? { color: "var(--accent)" } : undefined}
          >
            {ttsEnabled ? <IconSpeaker /> : <IconSpeakerOff />}
          </button>
        )}

        {getSpeechRecognitionCtor() && (
          <button className="command-pill__toggle" onClick={toggleVoice} aria-label={listening ? "Stop listening" : "Voice input"} style={listening ? { color: "var(--danger-400)" } : undefined}>
            <IconMic />
          </button>
        )}

        <button className="command-pill__toggle" onClick={handleSubmit} disabled={!text.trim()} aria-label="Send" style={text.trim() ? { color: "var(--accent)" } : undefined}>
          <IconSend />
        </button>

        {entries.length > 0 && (
          <button className="command-pill__toggle" onClick={() => setExpanded(!expanded)} aria-label={expanded ? "Collapse timeline" : "Expand timeline"}>
            {expanded ? <IconChevronDown /> : <IconChevronUp />}
          </button>
        )}

        <button className="command-pill__toggle" onClick={() => setHidden(true)} aria-label="Hide command input" title="Hide">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
    </div>
  );
}

// Voice engine — Phase 3 prototype uses Web Speech API.
// Production path: swap in ElevenLabs proxy engine without changing call sites.

export interface VoiceEngine {
  speak(text: string, priority?: "high" | "normal"): Promise<void>;
  cancel(): void;
  isSupported(): boolean;
}

const RECENT_SPEECH_KEY = "aura:pulse:recent-speech";
const RECENT_SPEECH_WINDOW_MS = 2_000;
const SPEAKER_LEASE_KEY = "aura:pulse:speaker-lease";
const SPEAKER_LEASE_WINDOW_MS = 5_000;

interface RecentSpeechRecord {
  text: string;
  timestamp: number;
}

interface SpeakerLeaseRecord {
  tabId: string;
  timestamp: number;
}

let recentSpeech: RecentSpeechRecord | null = null;
const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `tab-${Math.random().toString(36).slice(2)}`;

function readRecentSpeech(): RecentSpeechRecord | null {
  if (typeof window === "undefined") return recentSpeech;

  try {
    const raw = window.localStorage.getItem(RECENT_SPEECH_KEY);
    if (!raw) {
      recentSpeech = null;
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RecentSpeechRecord>;
    if (typeof parsed.text !== "string" || typeof parsed.timestamp !== "number") {
      recentSpeech = null;
      return null;
    }
    recentSpeech = { text: parsed.text, timestamp: parsed.timestamp };
    return recentSpeech;
  } catch {
    return recentSpeech;
  }
}

function writeRecentSpeech(text: string, timestamp: number): void {
  recentSpeech = { text, timestamp };
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(RECENT_SPEECH_KEY, JSON.stringify(recentSpeech));
  } catch {
    // Ignore storage failures; in-memory de-dupe still protects this tab.
  }
}

function shouldSuppressSpeech(text: string): boolean {
  const last = readRecentSpeech();
  if (!last) return false;
  return last.text === text && Date.now() - last.timestamp < RECENT_SPEECH_WINDOW_MS;
}

function isVisibleDocument(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}

function readSpeakerLease(): SpeakerLeaseRecord | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(SPEAKER_LEASE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SpeakerLeaseRecord>;
    if (typeof parsed.tabId !== "string" || typeof parsed.timestamp !== "number") {
      return null;
    }
    return { tabId: parsed.tabId, timestamp: parsed.timestamp };
  } catch {
    return null;
  }
}

function writeSpeakerLease(timestamp: number): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      SPEAKER_LEASE_KEY,
      JSON.stringify({ tabId, timestamp }),
    );
  } catch {
    // Ignore storage failures; same-tab de-dupe still helps.
  }
}

function clearSpeakerLease(): void {
  if (typeof window === "undefined") return;

  const lease = readSpeakerLease();
  if (!lease || lease.tabId !== tabId) return;

  try {
    window.localStorage.removeItem(SPEAKER_LEASE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function canCurrentTabSpeak(): boolean {
  if (!isVisibleDocument()) return false;

  const now = Date.now();
  const lease = readSpeakerLease();
  if (lease && lease.tabId !== tabId && now - lease.timestamp < SPEAKER_LEASE_WINDOW_MS) {
    return false;
  }

  writeSpeakerLease(now);
  return true;
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      clearSpeakerLease();
    }
  });
}

class WebSpeechEngine implements VoiceEngine {
  isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  speak(text: string, priority: "high" | "normal" = "normal"): Promise<void> {
    const normalized = text.trim();
    if (!normalized || !this.isSupported()) return Promise.resolve();
    if (!canCurrentTabSpeak()) return Promise.resolve();
    if (shouldSuppressSpeech(normalized)) return Promise.resolve();

    writeRecentSpeech(normalized, Date.now());
    if (priority === "high") window.speechSynthesis.cancel();
    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(normalized);
      utterance.rate = 0.92;
      utterance.pitch = 0.95;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve(); // Never block rendering on voice error
      window.speechSynthesis.speak(utterance);
    });
  }

  cancel(): void {
    if (this.isSupported()) window.speechSynthesis.cancel();
  }
}

export const voiceEngine: VoiceEngine = new WebSpeechEngine();

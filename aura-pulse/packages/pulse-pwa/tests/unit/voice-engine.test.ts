import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const cancel = vi.fn();
const speak = vi.fn((utterance: MockSpeechSynthesisUtterance) => {
  utterance.onend?.();
});

class MockSpeechSynthesisUtterance {
  text: string;
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(text: string) {
    this.text = text;
  }
}

vi.stubGlobal("SpeechSynthesisUtterance", MockSpeechSynthesisUtterance as typeof SpeechSynthesisUtterance);

Object.defineProperty(window, "speechSynthesis", {
  configurable: true,
  value: {
    cancel,
    speak,
  },
});

import { voiceEngine } from "../../src/voice/voice-engine.js";

describe("voiceEngine", () => {
  beforeEach(() => {
    window.localStorage.clear();
    cancel.mockClear();
    speak.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses the same utterance inside the de-duplication window", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_200)
      .mockReturnValueOnce(2_000);

    await voiceEngine.speak("Offer approved.", "high");
    await voiceEngine.speak("Offer approved.", "high");

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledTimes(1);
    expect((speak.mock.calls[0]?.[0] as MockSpeechSynthesisUtterance).text).toBe("Offer approved.");
  });

  it("allows the same utterance again after the de-duplication window", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_500)
      .mockReturnValueOnce(4_500);

    await voiceEngine.speak("Offer approved.", "high");
    await voiceEngine.speak("Offer approved.", "high");

    expect(cancel).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("does not speak from a hidden page", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    await voiceEngine.speak("Offer approved.", "high");

    expect(cancel).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("does not speak when another visible tab holds the speaker lease", async () => {
    window.localStorage.setItem(
      "aura:pulse:speaker-lease",
      JSON.stringify({ tabId: "other-tab", timestamp: 1_000 }),
    );
    vi.spyOn(Date, "now").mockReturnValue(1_500);

    await voiceEngine.speak("Offer approved.", "high");

    expect(cancel).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});
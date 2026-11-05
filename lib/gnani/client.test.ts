import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
vi.mock("server-only", () => ({}));
import { transcribe, synthesize, resolveVoice, clampSpeed, validateSttLanguage, sanitizeKeyterms } from "./client";
import { KeyPool } from "./pool";
import { getGnaniConfig, type GnaniConfig } from "./config";
import { startMockGnani, type MockGnani } from "./test-utils/mockGnani";

let mock: MockGnani;
beforeAll(async () => {
  mock = await startMockGnani({ validKeys: ["k1", "k2"] });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.requests.length = 0;
  mock.setLatency(0);
  mock.setCreditExhausted(false);
});

function deps(keys = ["k1"], over: Partial<GnaniConfig> = {}) {
  const config = { ...getGnaniConfig(), enabled: true, keys, baseUrl: mock.url, ...over };
  return { config, pool: new KeyPool({ keys, sleep: async () => {}, maxWaitMs: 2000 }) };
}
const audio = Buffer.from("RIFFxxxx");
const base = { audio, filename: "a.wav", mime: "audio/wav", languageCode: "hi-IN" };

describe("transcribe", () => {
  it("sends the documented multipart contract and parses the result", async () => {
    const r = await transcribe({ ...base, format: "transcribe", keyterms: ["आयरन", "  "], requestId: "rid-1" }, deps());
    expect(r).toMatchObject({ transcript: "mock transcript", requestId: "rid-1", truncated: false, detectedLanguage: "hi-IN" });
    const req = mock.requests[0];
    expect(req.key).toBe("k1");
    expect(req.fields).toMatchObject({ model: "prisma-v3.0", language_code: "hi-IN", format: "transcribe" });
    expect(JSON.parse(req.fields.keyterms)).toEqual(["आयरन"]);
  });
  it("validates locally without calling upstream", async () => {
    await expect(transcribe({ ...base, languageCode: "xx-IN" }, deps())).rejects.toMatchObject({ kind: "bad_request", code: "INVALID_LANGUAGE_CODE" });
    await expect(transcribe({ ...base, audio: Buffer.alloc(0) }, deps())).rejects.toMatchObject({ kind: "audio", code: "EMPTY_AUDIO" });
    await expect(transcribe({ ...base, languageCode: "hi-IN,en-IN" }, deps(["k1"], { sttModel: "prisma-v2.5" }))).rejects.toMatchObject({ kind: "bad_request" });
    expect(mock.requests).toHaveLength(0);
    expect(validateSttLanguage("hi-IN,en-IN", "prisma-v3.0")).toBe("hi-IN,en-IN");
    expect(validateSttLanguage("indic-auto", "prisma-v3.0")).toBe("indic-auto");
  });
  it("not configured", async () => {
    await expect(transcribe(base, deps([]))).rejects.toMatchObject({ kind: "not_configured" });
  });
  it("maps upstream failures and does not retry 400", async () => {
    mock.script({ status: 400, body: { success: false, error: { type: "UNSUPPORTED_AUDIO_FORMAT", message: "x" } } });
    await expect(transcribe(base, deps())).rejects.toMatchObject({ kind: "audio" });
    expect(mock.requests).toHaveLength(1);
  });
  it("retries 500 then succeeds", async () => {
    mock.script({ status: 500, body: { success: false, error: { type: "TRANSCRIPTION_FAILED", message: "x" } } });
    await expect(transcribe(base, deps())).resolves.toMatchObject({ transcript: "mock transcript" });
    expect(mock.requests).toHaveLength(2);
  });
  it("invalid key is an auth failure", async () => {
    await expect(transcribe(base, deps(["nope"]))).rejects.toMatchObject({ kind: "auth", code: "ALL_KEYS_DISABLED" });
  });
  it("402 from upstream fails fast as credit", async () => {
    mock.setCreditExhausted(true);
    const d = deps(["k1", "k2"]);
    await expect(transcribe(base, d)).rejects.toMatchObject({ kind: "credit" });
    await expect(transcribe(base, d)).rejects.toMatchObject({ kind: "credit" });
    expect(mock.requests).toHaveLength(1);
  });
  it("times out via AbortController (upstream 504 too)", async () => {
    mock.script({ status: 504, body: { error: "Gateway Timeout", code: "UPSTREAM_TIMEOUT", message: "t" } });
    await expect(transcribe(base, { ...deps(), pool: new KeyPool({ keys: ["k1"], sleep: async () => {}, retryDelaysMs: [] }) })).rejects.toMatchObject({ kind: "timeout" });
    const hang: typeof fetch = (_u, init) =>
      new Promise((_r, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    vi.useFakeTimers();
    const p = transcribe(base, { ...deps(), fetch: hang, pool: new KeyPool({ keys: ["k1"], retryDelaysMs: [] }) });
    const assertion = expect(p).rejects.toMatchObject({ kind: "timeout", code: "CLIENT_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(20_001);
    await assertion;
    vi.useRealTimers();
  });
  it("concurrent calls on one key never overlap upstream (no 429s)", async () => {
    mock.setLatency(15);
    const d = deps(["k1"]);
    const before = mock.rejected429();
    await Promise.all([1, 2, 3, 4].map(() => transcribe(base, d)));
    expect(mock.rejected429()).toBe(before);
    expect(mock.maxConcurrentPerKey()).toBe(1);
  });
  it("does not log transcripts", async () => {
    const spy = vi.mocked(console.info);
    spy.mockClear();
    await transcribe(base, deps());
    expect(spy.mock.calls.flat().join(" ")).not.toContain("mock transcript");
  });
});

describe("synthesize", () => {
  it("builds the documented body for mp3 and returns audio", async () => {
    const r = await synthesize({ text: "नमस्ते", language: "hi-IN", container: "mp3", gender: "male", speed: 2 }, deps());
    expect(r.contentType).toBe("audio/mpeg");
    expect(r.audio.length).toBe(4);
    expect(mock.requests[0].json).toMatchObject({
      text: "नमस्ते", model: "timbre-v3.0", voice: "Avinash", language: "hi-IN", speed: 1.15,
      audio_config: { container: "mp3", bitrate: "64k", sample_rate: 24000 },
    });
  });
  it("ogg and wav configs", async () => {
    await synthesize({ text: "a", language: "en-IN", container: "ogg" }, deps());
    await synthesize({ text: "a", language: "en-IN", container: "wav" }, deps());
    expect(mock.requests[0].json?.audio_config).toMatchObject({ container: "ogg", encoding: "oggopus" });
    expect(mock.requests[1].json?.audio_config).toMatchObject({ container: "wav", encoding: "pcm_s16le", num_channels: 1, sample_width: 2 });
  });
  it("validates input locally", async () => {
    await expect(synthesize({ text: "  ", language: "hi-IN", container: "mp3" }, deps())).rejects.toMatchObject({ code: "EMPTY_TEXT" });
    await expect(synthesize({ text: "x".repeat(601), language: "hi-IN", container: "mp3" }, deps())).rejects.toMatchObject({ code: "TEXT_TOO_LONG" });
    await expect(synthesize({ text: "x", language: "fr-FR", container: "mp3" }, deps())).rejects.toMatchObject({ code: "INVALID_LANGUAGE_CODE" });
    await expect(synthesize({ text: "x", language: "hi-IN", container: "mp3", bitrate: "1k" }, deps())).rejects.toMatchObject({ code: "INVALID_BITRATE" });
    expect(mock.requests).toHaveLength(0);
  });
  it("voice/model compatibility", () => {
    const v3 = { ttsModel: "timbre-v3.0" as const, voiceFemale: "Shivani", voiceMale: "Avinash" };
    const v25 = { ttsModel: "timbre-v2.5" as const, voiceFemale: "Shivani", voiceMale: "Avinash" };
    expect(resolveVoice(v3, "mr-IN", "Lakshmi")).toBe("Lakshmi");
    expect(resolveVoice(v3, "mr-IN", "Zahira")).toBe("Shivani"); // v2.5 voice on v3 -> default
    expect(resolveVoice(v3, "mr-IN", "bogus", "male")).toBe("Avinash");
    expect(resolveVoice(v25, "mr-IN", "Shivani", "female")).toBe("Zahira");
    expect(resolveVoice(v25, "gu-IN", undefined, "male")).toBe("Veera");
    expect(() => resolveVoice(v25, "ta-IN")).toThrow();
  });
  it("clamps speed", () => {
    expect(clampSpeed(0.1)).toBe(0.85);
    expect(clampSpeed(5)).toBe(1.15);
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed("slow")).toBe("slow");
    expect(clampSpeed(NaN)).toBeUndefined();
    expect(clampSpeed(undefined)).toBeUndefined();
  });
  it("maps JSON error bodies", async () => {
    mock.script({ status: 400, body: { success: false, message: "bad", status_code: 400 } });
    await expect(synthesize({ text: "x", language: "hi-IN", container: "mp3" }, deps())).rejects.toMatchObject({ kind: "bad_request" });
  });
});

describe("sanitizeKeyterms", () => {
  it("strips control chars, caps length and count, dedupes", () => {
    expect(sanitizeKeyterms(["a\u0000b\n", "a b", "x".repeat(60)])).toEqual(["a b", "x".repeat(40)]);
    expect(sanitizeKeyterms(Array.from({ length: 300 }, (_, i) => `t${i}`))).toHaveLength(200);
  });
});

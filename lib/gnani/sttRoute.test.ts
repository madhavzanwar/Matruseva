import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const getCurrentUser = vi.fn();
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser() }));

import { POST } from "@/app/api/gnani/stt/route";

// Mirrors the 3 MB cap in the route (route files may not export extra constants).
const MAX_BODY_BYTES = 3 * 1024 * 1024;
import { GET } from "@/app/api/gnani/status/route";
import { startMockGnani, type MockGnani } from "./test-utils/mockGnani";
import { resetSharedPool } from "./pool";
import { resetLimiter } from "./limits";

let mock: MockGnani;
beforeAll(async () => {
  mock = await startMockGnani({ validKeys: ["k1"] });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.requests.length = 0;
  mock.setCreditExhausted(false);
  getCurrentUser.mockResolvedValue({ userId: "u1", role: "doctor" });
  vi.stubEnv("GNANI_API_KEYS", "k1");
  vi.stubEnv("GNANI_BASE_URL", mock.url);
  resetSharedPool();
  resetLimiter();
});
afterEach(() => vi.unstubAllEnvs());

const wav = () => {
  const b = new Uint8Array(44 + 32000);
  b.set([82, 73, 70, 70]);
  new DataView(b.buffer).setUint32(28, 32000, true);
  return b;
};
function req(opts: { file?: Blob | null; name?: string; language?: string; extra?: Record<string, string> } = {}) {
  const fd = new FormData();
  if (opts.file !== null) fd.set("audio", opts.file ?? new Blob([wav()], { type: "audio/wav" }), opts.name ?? "a.wav");
  fd.set("language", opts.language ?? "hi");
  for (const [k, v] of Object.entries(opts.extra ?? {})) fd.set(k, v);
  return new Request("http://localhost/api/gnani/stt", { method: "POST", body: fd });
}
const json = async (r: Response) => ({ status: r.status, body: await r.json(), cache: r.headers.get("cache-control") });

describe("POST /api/gnani/stt", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    expect(await json(await POST(req()))).toMatchObject({ status: 401, body: { ok: false, code: "unauthenticated" } });
  });
  it("503 gnani_not_configured (also in demo mode without keys)", async () => {
    vi.stubEnv("GNANI_API_KEYS", "");
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true });
    expect(await json(await POST(req()))).toMatchObject({ status: 503, body: { code: "gnani_not_configured", retryable: false } });
    vi.stubEnv("GNANI_API_KEYS", "k1");
    vi.stubEnv("GNANI_ENABLED", "0");
    expect((await json(await POST(req()))).body.code).toBe("gnani_not_configured");
  });
  it("happy path", async () => {
    const r = await json(await POST(req({ extra: { keyterms: JSON.stringify(["आयरन", "x\u0000y"]) } })));
    expect(r).toMatchObject({ status: 200, cache: "no-store", body: { ok: true, transcript: "mock transcript", detectedLanguage: "hi-IN" } });
    expect(r.body.requestId).toBeTruthy();
    expect(mock.requests[0].fields).toMatchObject({ model: "prisma-v3.0", format: "transcribe", language_code: "hi-IN" });
    expect(JSON.parse(mock.requests[0].fields.keyterms)).toEqual(["आयरन", "x y"]);
  });
  it("sends a fixed clinical topic and sanitised previous_text (last 600 chars)", async () => {
    const long = "a".repeat(300) + "\u0000 \n  बीपी 130/80 " + "z".repeat(700);
    expect((await POST(req({ extra: { previous_text: long } }))).status).toBe(200);
    const f = mock.requests[0].fields;
    expect(f.topic).toContain("Antenatal clinic vitals dictation");
    expect(f.previous_text.length).toBe(600);
    expect(f.previous_text).toMatch(/^z+$/);
    mock.requests.length = 0;
    await POST(req({ extra: { previous_text: "ठीक है \u0001 बीपी  130" } }));
    expect(mock.requests[0].fields.previous_text).toBe("ठीक है बीपी 130");
    mock.requests.length = 0;
    await POST(req({ extra: { previous_text: "   " , topic: "client topic" } }));
    expect(mock.requests[0].fields.previous_text).toBeUndefined();
    expect(mock.requests[0].fields.topic).not.toBe("client topic");
  });
  it("rejects webm (by type, extension and magic bytes)", async () => {
    for (const f of [
      { file: new Blob([wav()], { type: "audio/webm;codecs=opus" }), name: "a.webm" },
      { file: new Blob([wav()], { type: "audio/wav" }), name: "a.webm" },
      { file: new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2])], { type: "audio/wav" }), name: "a.wav" },
    ]) {
      const r = await json(await POST(req(f)));
      expect(r).toMatchObject({ status: 415, body: { ok: false, code: "audio_unsupported" } });
      expect(r.body.detail).toContain("WAV");
    }
    expect((await json(await POST(req({ file: new Blob(["x"], { type: "text/plain" }), name: "a.txt" })))).body.code).toBe("audio_unsupported");
    expect(mock.requests).toHaveLength(0);
  });
  it("accepts octet-stream with a good extension", async () => {
    const r = await json(await POST(req({ file: new Blob([wav()], { type: "application/octet-stream" }), name: "a.wav" })));
    expect(r.status).toBe(200);
  });
  it("413 when oversize", async () => {
    const big = new Blob([new Uint8Array(MAX_BODY_BYTES + 10)], { type: "audio/mpeg" });
    expect(await json(await POST(req({ file: big, name: "a.mp3" })))).toMatchObject({ status: 413, body: { code: "payload_too_large" } });
  });
  it("validates inputs", async () => {
    expect((await json(await POST(req({ file: null })))).body.code).toBe("audio_empty");
    expect((await json(await POST(req({ language: "fr" })))).body.code).toBe("bad_language");
    expect((await json(await POST(req({ extra: { keyterms: "not json" } })))).status).toBe(400);
    expect((await json(await POST(req({ extra: { format: "weird" } })))).status).toBe(400);
  });
  it("429 rate_limited with Retry-After", async () => {
    vi.stubEnv("GNANI_STT_PER_MINUTE", "1");
    expect((await POST(req())).status).toBe(200);
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited", retryable: true });
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("429 budget_exceeded", async () => {
    vi.stubEnv("GNANI_STT_DAILY_SECONDS_PER_USER", "1");
    expect((await POST(req())).status).toBe(200); // ~1 s wav
    expect((await json(await POST(req()))).body.code).toBe("budget_exceeded");
  });
  it("maps upstream 429 (after retries) and 402", async () => {
    vi.stubEnv("GNANI_API_KEYS", "k1");
    mock.script(...Array(4).fill({ status: 429, body: { detail: { error_code: "RATE_LIMITED", message: "", status_code: 429 } } }));
    const r = await json(await POST(req())); // real backoff 0.5+1+2 s
    expect(r).toMatchObject({ status: 503, body: { code: "gnani_unavailable", retryable: true } });
    mock.setCreditExhausted(true);
    resetSharedPool();
    expect(await json(await POST(req()))).toMatchObject({ status: 503, body: { code: "gnani_unavailable" } });
  }, 15_000);
  it("maps upstream audio_too_long", async () => {
    mock.script({ status: 400, body: { success: false, error: { type: "MAX_AUDIO_DURATION_EXCEEDED", message: "" } } });
    expect(await json(await POST(req()))).toMatchObject({ status: 413, body: { code: "audio_too_long" } });
  });
  it("never leaks secrets in responses", async () => {
    mock.script({ status: 401, body: { detail: { error_code: "INVALID_API_KEY", message: "key k1 invalid", status_code: 401 } } });
    const text = JSON.stringify((await json(await POST(req()))).body);
    expect(text).not.toContain("k1");
  });
});

describe("GET /api/gnani/status", () => {
  it("401 unauthenticated", async () => {
    getCurrentUser.mockRejectedValue(new Error("x"));
    expect((await GET()).status).toBe(401);
  });
  it("reports state without secrets", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, sttModel: "prisma-v3.0", ttsModel: "timbre-v3.0", keyCount: 1, circuitOpen: false });
    expect(body.budgetRemaining.sttSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("k1");
    expect(res.headers.get("cache-control")).toBe("no-store");
    vi.stubEnv("GNANI_API_KEYS", "");
    expect((await (await GET()).json()).enabled).toBe(false);
  });
});

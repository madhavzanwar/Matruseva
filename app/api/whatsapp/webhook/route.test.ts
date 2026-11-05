import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  handle: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
}));
vi.mock("@/lib/whatsappBot", async (orig) => ({
  ...(await orig<typeof import("@/lib/whatsappBot")>()),
  handleIncomingWhatsAppMessage: h.handle,
}));
vi.mock("@/lib/gnani/client", () => ({ transcribe: h.transcribe, synthesize: h.synthesize }));

import { GET, POST } from "./route";
import { GnaniError } from "@/lib/gnani/errors";
import { resetLimiter } from "@/lib/gnani/limits";

const textBody = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [{ changes: [{ value: { messages: [{ type: "text", from: "919999999999", text: { body: "1" } }] } }] }],
});
const batch = (messages: unknown[]) =>
  JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages } }] }] });
const audioMsg = (id = "MEDIA1", from = "919999999999") => ({ type: "audio", from, audio: { id, mime_type: "audio/ogg; codecs=opus", voice: true } });

const sign = (b: string, s: string) => "sha256=" + createHmac("sha256", s).update(b).digest("hex");
const post = (b: string, sig?: string) =>
  new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body: b, headers: sig ? { "x-hub-signature-256": sig } : {} });
const signed = (b: string) => POST(post(b, sign(b, "s")));

interface Sent {
  url: string;
  method: string;
  body?: Record<string, unknown>;
  form?: FormData;
  auth?: string | null;
}
let calls: Sent[];
let failMedia: Set<string>;
let failUpload = false;

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const rec: Sent = { url, method: init?.method ?? "GET", auth: headers.get("authorization") };
  if (typeof init?.body === "string") rec.body = JSON.parse(init.body);
  if (init?.body instanceof FormData) rec.form = init.body;
  calls.push(rec);
  const json = (o: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } }));
  const m = url.match(/graph\.facebook\.com\/v21\.0\/([^/]+)(\/(messages|media))?$/);
  if (m && !m[2]) {
    if (failMedia.has(m[1])) return json({ error: "x" }, 404);
    return json({ url: `https://lookaside.fbsbx.com/${m[1]}`, mime_type: "audio/ogg", file_size: 7000 });
  }
  if (url.startsWith("https://lookaside.fbsbx.com/")) return Promise.resolve(new Response(new Uint8Array(7000), { headers: { "content-type": "audio/ogg" } }));
  if (m && m[3] === "messages") return json({ messages: [{ id: "wamid" }] });
  if (m && m[3] === "media") return failUpload ? json({}, 500) : json({ id: "UPLOADED" });
  return json({}, 404);
}
const sentTexts = () => calls.filter((c) => c.url.endsWith("/messages") && c.body?.type === "text").map((c) => String((c.body!.text as { body: string }).body));
const sentAudio = () => calls.filter((c) => c.url.endsWith("/messages") && c.body?.type === "audio");
const mediaCalls = () => calls.filter((c) => !c.url.endsWith("/messages"));

beforeEach(() => {
  calls = [];
  failMedia = new Set();
  failUpload = false;
  resetLimiter();
  h.handle.mockReset().mockResolvedValue({ success: true, replyText: "✅ *Thanks* https://x.test/a", actionTaken: "confirmed_visit" });
  h.transcribe.mockReset().mockResolvedValue({ transcript: "हाँ मैं आऊँगी।", detectedLanguage: "hi-IN", requestId: "r", truncated: false });
  h.synthesize.mockReset().mockResolvedValue({ audio: Buffer.from([1, 2, 3]), contentType: "audio/ogg" });
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function configure(extra: Record<string, string> = {}) {
  vi.stubEnv("WHATSAPP_APP_SECRET", "s");
  vi.stubEnv("WHATSAPP_API_TOKEN", "tok-secret");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "123456789");
  vi.stubEnv("GNANI_API_KEY", "gnani-test-key");
  for (const [k, v] of Object.entries(extra)) vi.stubEnv(k, v);
}

describe("whatsapp webhook (security + text)", () => {
  it("GET rejects the old default token and an unset token", async () => {
    const url = "http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=matrusetu_secret&hub.challenge=c";
    expect((await GET(new NextRequest(url))).status).toBe(403);
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "real");
    expect((await GET(new NextRequest(url))).status).toBe(403);
    expect((await GET(new NextRequest(url.replace("matrusetu_secret", "real")))).status).toBe(200);
  });

  it("POST fails closed when no app secret is configured", async () => {
    expect((await POST(post(textBody, sign(textBody, "s")))).status).toBe(503);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("POST rejects missing or wrong signatures", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "s");
    expect((await POST(post(textBody))).status).toBe(401);
    expect((await POST(post(textBody, sign(textBody, "wrong")))).status).toBe(401);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("bad HMAC on an audio payload is 401 before any media, Gnani or Graph call", async () => {
    configure();
    const b = batch([audioMsg()]);
    expect((await POST(post(b, sign(b, "wrong")))).status).toBe(401);
    expect((await POST(post(b))).status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("POST rejects the old unauthenticated simulator payload", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "s");
    const sim = JSON.stringify({ messageText: "1", patientId: "p" });
    expect((await POST(post(sim))).status).toBe(401);
    expect((await POST(post(sim, sign(sim, "s")))).status).toBe(400);
    expect(h.handle).not.toHaveBeenCalled();
  });

  it("POST processes a correctly signed text payload and replies through the helper", async () => {
    configure();
    expect((await signed(textBody)).status).toBe(200);
    expect(h.handle).toHaveBeenCalledWith({ phone: "919999999999", messageText: "1" });
    expect(sentTexts()).toEqual(["✅ *Thanks* https://x.test/a"]);
    expect(calls[0].auth).toBe("Bearer tok-secret");
  });
});

describe("whatsapp webhook (voice notes)", () => {
  it("happy path: download -> transcribe -> intent handler -> text reply", async () => {
    configure();
    const res = await signed(batch([audioMsg()]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "EVENT_RECEIVED" });

    // two-step Graph download, both with the bearer token
    const dl = mediaCalls();
    expect(dl[0].url).toBe("https://graph.facebook.com/v21.0/MEDIA1");
    expect(dl[1].url).toBe("https://lookaside.fbsbx.com/MEDIA1");
    expect(dl.every((c) => c.auth === "Bearer tok-secret")).toBe(true);

    const t = h.transcribe.mock.calls[0][0];
    expect(t).toMatchObject({ filename: "voice.ogg", mime: "audio/ogg", languageCode: "indic-auto", format: "transcribe" });
    expect(Buffer.isBuffer(t.audio)).toBe(true);

    expect(h.handle).toHaveBeenCalledWith(expect.objectContaining({ phone: "919999999999", messageText: "हाँ मैं आऊँगी।", via: "voice", preferredLang: "hi" }));
    expect(sentTexts()).toHaveLength(1);
    expect(sentAudio()).toHaveLength(0);
    expect(h.synthesize).not.toHaveBeenCalled();
  });

  it("GNANI_WA_LANGS overrides the STT language hint", async () => {
    configure({ GNANI_WA_LANGS: "hi-IN, mr-IN,gu-IN" });
    await signed(batch([audioMsg()]));
    expect(h.transcribe.mock.calls[0][0].languageCode).toBe("hi-IN,mr-IN,gu-IN");
  });

  it("WHATSAPP_VOICE_REPLIES=1 also sends a spoken reply (clean text, ogg, upload then send)", async () => {
    configure({ WHATSAPP_VOICE_REPLIES: "1" });
    await signed(batch([audioMsg()]));
    expect(sentTexts()).toHaveLength(1);
    const syn = h.synthesize.mock.calls[0][0];
    expect(syn.container).toBe("ogg");
    expect(syn.language).toBe("en-IN");
    expect(syn.text).not.toMatch(/[*✅]|https?:/);
    expect(syn.text).toContain("Thanks");
    const upload = calls.find((c) => c.url.endsWith("/media"))!;
    expect(upload.form!.get("type")).toBe("audio/ogg");
    expect(upload.form!.get("messaging_product")).toBe("whatsapp");
    expect(upload.form!.get("file")).toBeInstanceOf(Blob);
    expect(sentAudio()[0].body).toMatchObject({ to: "919999999999", type: "audio", audio: { id: "UPLOADED" } });
  });

  it("uses a Marathi / Gujarati / Hindi Timbre language for the spoken reply", async () => {
    configure({ WHATSAPP_VOICE_REPLIES: "1" });
    h.handle.mockResolvedValue({ success: true, replyText: "धन्यवाद ताई! आपल्या तपासणीची नोंद झाली आहे.", actionTaken: "x" });
    await signed(batch([audioMsg()]));
    expect(h.synthesize.mock.calls[0][0].language).toBe("mr-IN");
    h.handle.mockResolvedValue({ success: true, replyText: "धन्यवाद जी, आपकी पुष्टि दर्ज हो गई।", actionTaken: "x" });
    await signed(batch([audioMsg("M2", "919888888888")]));
    expect(h.synthesize.mock.calls[1][0].language).toBe("hi-IN");
  });

  it("a TTS / upload failure leaves the text reply intact and returns 200", async () => {
    configure({ WHATSAPP_VOICE_REPLIES: "1" });
    h.synthesize.mockRejectedValue(new GnaniError({ kind: "upstream", status: 500 }));
    expect((await signed(batch([audioMsg()]))).status).toBe(200);
    expect(sentTexts()).toHaveLength(1);
    expect(sentAudio()).toHaveLength(0);

    failUpload = true;
    h.synthesize.mockResolvedValue({ audio: Buffer.from([1]), contentType: "audio/ogg" });
    expect((await signed(batch([audioMsg("M3", "919777777777")]))).status).toBe(200);
    expect(sentAudio()).toHaveLength(0);
  });

  it("audio_too_long -> short-note request (30 s), no intent handling", async () => {
    configure();
    h.transcribe.mockRejectedValue(new GnaniError({ kind: "audio", code: "MAX_AUDIO_DURATION_EXCEEDED" }));
    expect((await signed(batch([audioMsg()]))).status).toBe(200);
    expect(h.handle).not.toHaveBeenCalled();
    const [msg] = sentTexts();
    expect(msg).toContain("30");
    expect(msg).toContain("सेकंड");
  });

  it("Gnani unavailable (error or not configured) -> asks for 1/2/3 as text, no upstream text leaked", async () => {
    configure();
    h.transcribe.mockRejectedValue(new GnaniError({ kind: "upstream", status: 502, message: "SECRET upstream detail" }));
    await signed(batch([audioMsg()]));
    expect(sentTexts()[0]).toContain("1, 2 or 3");
    expect(JSON.stringify(calls)).not.toContain("SECRET upstream detail");

    calls = [];
    vi.stubEnv("GNANI_API_KEY", "");
    vi.stubEnv("GNANI_API_KEYS", "");
    h.transcribe.mockClear();
    await signed(batch([audioMsg("M2", "919888888888")]));
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(mediaCalls()).toHaveLength(0);
    expect(sentTexts()[0]).toContain("1, 2 or 3");
  });

  it("empty / unintelligible transcript -> repeat or type request", async () => {
    configure();
    h.transcribe.mockResolvedValue({ transcript: "  ... ", requestId: "r", truncated: false });
    await signed(batch([audioMsg()]));
    expect(h.handle).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toContain("speak again");
  });

  it("Graph download failure -> friendly text, Gnani never called, 200", async () => {
    configure();
    failMedia.add("BAD");
    expect((await signed(batch([audioMsg("BAD")]))).status).toBe(200);
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(sentTexts()[0]).toContain("1, 2 or 3");
  });

  it("per-sender rate limit: extra notes in a minute are not transcribed", async () => {
    configure({ GNANI_STT_PER_MINUTE: "2" });
    const res = await signed(batch([audioMsg("A"), audioMsg("B"), audioMsg("C")]));
    expect(res.status).toBe(200);
    expect(h.transcribe).toHaveBeenCalledTimes(2);
    expect(sentTexts()).toHaveLength(3);
    // another sender is unaffected
    await signed(batch([audioMsg("D", "919111111111")]));
    expect(h.transcribe).toHaveBeenCalledTimes(3);
  });

  it("refunds the budget when transcription fails", async () => {
    configure({ GNANI_STT_DAILY_SECONDS_PER_USER: "6" });
    h.transcribe.mockRejectedValueOnce(new GnaniError({ kind: "timeout" })).mockRejectedValueOnce(new GnaniError({ kind: "timeout" }));
    // each note reserves 3 s (7000 B / 2500 = 3 s); without refunds the 3rd would be blocked
    await signed(batch([audioMsg("A"), audioMsg("B"), audioMsg("C")]));
    expect(h.transcribe).toHaveBeenCalledTimes(3);
  });

  it("mixed batch: a failing download and a throwing handler do not stop the others", async () => {
    configure();
    failMedia.add("BAD");
    h.handle.mockRejectedValueOnce(new Error("db down")).mockResolvedValue({ success: true, replyText: "ok", actionTaken: "x" });
    const msgs = [
      audioMsg("BAD", "911000000001"),
      { type: "text", from: "911000000002", text: { body: "1" } }, // handler throws
      audioMsg("GOOD", "911000000003"),
      { type: "image", from: "911000000004" },
      null,
      { type: "text", from: "911000000005", text: { body: "2" } },
    ];
    const res = await signed(batch(msgs));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "EVENT_RECEIVED" });
    expect(h.handle).toHaveBeenCalledTimes(3);
    const to = calls.filter((c) => c.url.endsWith("/messages")).map((c) => c.body!.to);
    expect(to).toEqual(["911000000001", "911000000003", "911000000005"]);
  });

  it("never sends the WhatsApp token anywhere but Authorization", async () => {
    configure({ WHATSAPP_VOICE_REPLIES: "1" });
    await signed(batch([audioMsg()]));
    const noAuth = calls.map((c) => ({ ...c, auth: undefined }));
    expect(JSON.stringify(noAuth, (_k, v) => (v instanceof FormData ? "form" : v))).not.toContain("tok-secret");
    const logged = JSON.stringify([...(console.error as unknown as { mock: { calls: unknown[] } }).mock.calls]);
    expect(logged).not.toContain("tok-secret");
  });
});

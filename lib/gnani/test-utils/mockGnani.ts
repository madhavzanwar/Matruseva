import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * In-process mock of the documented Gnani contract (no network beyond
 * localhost). Auth via X-API-Key-ID, STT/TTS success + error shapes, and 429
 * whenever a key already has a request in flight.
 */
export interface MockOptions {
  validKeys: string[];
  /** Hold each request this long (ms) so concurrency can be observed. */
  latencyMs?: number;
}
export interface RecordedRequest {
  path: string;
  key: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  fields: Record<string, string>;
  json?: Record<string, unknown>;
}
export interface MockGnani {
  url: string;
  requests: RecordedRequest[];
  /** Highest number of simultaneous accepted requests seen on any single key. */
  maxConcurrentPerKey: () => number;
  rejected429: () => number;
  /** Queue scripted responses consumed (after auth) by the next STT/TTS requests. */
  script: (...r: Array<{ status: number; body?: unknown; raw?: string; delayMs?: number }>) => void;
  setLatency: (ms: number) => void;
  setCreditExhausted: (v: boolean) => void;
  close: () => Promise<void>;
}

export async function startMockGnani(opts: MockOptions): Promise<MockGnani> {
  const requests: RecordedRequest[] = [];
  const active = new Map<string, number>();
  let maxConc = 0;
  let r429 = 0;
  let latency = opts.latencyMs ?? 0;
  let credit = false;
  const scripted: Array<{ status: number; body?: unknown; raw?: string; delayMs?: number }> = [];

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const send = (status: number, body: unknown, type = "application/json") => {
      res.statusCode = status;
      res.setHeader("content-type", type);
      res.end(Buffer.isBuffer(body) ? body : typeof body === "string" ? body : JSON.stringify(body));
    };
    const key = req.headers["x-api-key-id"] as string | undefined;
    const path = req.url ?? "";
    if (!key) return send(401, { detail: { error_code: "MISSING_API_KEY", message: "missing", status_code: 401 } });
    if (!opts.validKeys.includes(key)) return send(401, { detail: { error_code: "INVALID_API_KEY", message: "invalid", status_code: 401 } });

    const rec: RecordedRequest = { path, key, headers: req.headers, fields: {} };
    const isStt = path.startsWith("/stt/v3");
    if (isStt) {
      try {
        const fd = await new Request("http://x/", { method: "POST", headers: { "content-type": String(req.headers["content-type"]) }, body: raw }).formData();
        for (const [k, v] of fd.entries()) rec.fields[k] = typeof v === "string" ? v : `file:${v.size}`;
      } catch {
        /* leave empty */
      }
    } else {
      try {
        rec.json = JSON.parse(raw.toString("utf8"));
      } catch {
        /* ignore */
      }
    }
    requests.push(rec);

    if ((active.get(key) ?? 0) >= 1) {
      r429++;
      return send(429, { detail: { error_code: "RATE_LIMITED", message: "one at a time", status_code: 429 } });
    }
    active.set(key, 1);
    maxConc = Math.max(maxConc, 1);
    const done = () => active.set(key, 0);
    try {
      const s = scripted.shift();
      const wait = s?.delayMs ?? latency;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      if (credit) return send(402, { detail: { message: "Insufficient credit", status_code: 402 } });
      if (s) return s.raw !== undefined ? send(s.status, s.raw, "text/plain") : send(s.status, s.body ?? {});
      if (isStt) {
        if (!rec.fields.language_code) return send(422, { detail: [{ loc: ["body", "language_code"], msg: "field required" }] });
        if (rec.fields.audio_file === "file:0") return send(400, { success: false, error: { type: "EMPTY_AUDIO", message: "empty" } });
        return send(200, {
          success: true,
          request_id: String(req.headers["x-api-request-id"] ?? "mock-req"),
          transcript: "mock transcript",
          model: rec.fields.model,
          detected_language_code: rec.fields.language_code?.split(",")[0],
          processing_time: 0.1,
          end_to_end_latency: 0.2,
        });
      }
      if (path.startsWith("/api/v1/tts/inference")) {
        const j = rec.json ?? {};
        if (!j.text) return send(400, { success: false, message: "text required", status_code: 400 });
        const container = (j.audio_config as { container?: string } | undefined)?.container ?? "mp3";
        const type = container === "mp3" ? "audio/mpeg" : `audio/${container}`;
        return send(200, Buffer.from([1, 2, 3, 4]), type);
      }
      return send(404, { detail: "not found" });
    } finally {
      done();
    }
  });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    maxConcurrentPerKey: () => maxConc,
    rejected429: () => r429,
    script: (...r) => void scripted.push(...r),
    setLatency: (ms) => void (latency = ms),
    setCreditExhausted: (v) => void (credit = v),
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
  };
}

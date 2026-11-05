import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGnaniConfig } from "@/lib/gnani/config";
import { transcribe, sanitizeKeyterms, type SttFormat } from "@/lib/gnani/client";
import { isGnaniError, toClientError } from "@/lib/gnani/errors";
import { getLimiter, estimateAudioSeconds, type LimitResult } from "@/lib/gnani/limits";
import { toGnaniLanguage, isGnaniLanguageCode } from "@/lib/gnani/languages";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Whole request body cap (audio + fields). */
const MAX_BODY_BYTES = 3 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 30;
const ALLOWED_EXT = new Set(["wav", "mp3", "ogg", "flac", "aac", "m4a"]);
const ALLOWED_MIME = new Set([
  "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
  "audio/mpeg", "audio/mp3",
  "audio/ogg", "application/ogg",
  "audio/flac", "audio/x-flac",
  "audio/aac", "audio/x-aac",
  "audio/mp4", "audio/x-m4a", "audio/m4a",
]);
const FORMATS = ["verbatim", "transcribe", "codemix", "transliterate"];
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_PREVIOUS_TEXT = 600;
/** Fixed server-side context so Prisma biases toward clinical content (never client-supplied). */
const STT_TOPIC =
  "Antenatal clinic vitals dictation: blood pressure, haemoglobin, weight, foetal heart rate, fundal height, symptoms";
const WEBM_HINT = "WebM/Opus is not supported; encode the recording as 16-bit PCM WAV before upload (developer note, not for display).";

function fail(status: number, code: string, retryable = false, extra?: Record<string, unknown>, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, code, retryable, ...extra }, { status, headers: { ...NO_STORE, ...headers } });
}

function limitFail(r: Extract<LimitResult, { ok: false }>) {
  return fail(429, r.code, true, undefined, { "Retry-After": String(r.retryAfterSec) });
}

/** Read the body but give up as soon as it exceeds `max` bytes. */
async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** Last <=600 chars, control characters stripped, whitespace collapsed. */
function sanitizePreviousText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return clean ? clean.slice(-MAX_PREVIOUS_TEXT) : undefined;
}

function resolveLanguage(raw: string): string | null {
  const v = raw.trim();
  return toGnaniLanguage(v) ?? (isGnaniLanguageCode(v) || v === "indic-auto" || /^[a-z]{2}-IN(,[a-z]{2}-IN){1,3}$/.test(v) ? v : null);
}

/**
 * POST /api/gnani/stt  (multipart/form-data)
 *   audio     file   wav|mp3|ogg|flac|aac|m4a, <= 30 s, body <= 3 MB (WebM rejected)
 *   language  text   app language (en|hi|mr|gu), Gnani code, `indic-auto` or "hi-IN,en-IN"
 *   keyterms  text?  JSON array of strings (<=200, each <=40 chars)
 *   previous_text text?  transcript so far (last 600 chars kept) for continuation segments
 *   format    text?  verbatim|transcribe (default)|codemix|transliterate
 * 200 { ok:true, transcript, detectedLanguage, requestId }
 * else { ok:false, code, retryable } (codes: see lib/gnani/errors.ts toClientError, plus
 *   unauthenticated, rate_limited, budget_exceeded, payload_too_large, bad_request, audio_*).
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return fail(401, "unauthenticated");
  }
  const config = getGnaniConfig();
  if (!config.enabled || config.keys.length === 0) return fail(503, "gnani_not_configured");

  const limiter = getLimiter();
  const rate = limiter.checkRate(user.userId, "stt");
  if (!rate.ok) return limitFail(rate);

  const body = await readCapped(request, MAX_BODY_BYTES);
  if (!body) return fail(413, "payload_too_large");

  let form: FormData;
  try {
    form = await new Request("http://local/", {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") ?? "" },
      body: body as BodyInit,
    }).formData();
  } catch {
    return fail(400, "bad_request");
  }

  const file = form.get("audio");
  if (!(file instanceof Blob)) return fail(400, "audio_empty");
  if (file.size === 0) return fail(400, "audio_empty");

  const filename = (file as File).name ?? "audio";
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const mime = (file.type || "").split(";")[0].trim().toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isWebmMagic = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (ext === "webm" || mime.includes("webm") || isWebmMagic) return fail(415, "audio_unsupported", false, { detail: WEBM_HINT });
  const generic = mime === "" || mime === "application/octet-stream";
  if (!(ALLOWED_MIME.has(mime) || (generic && ALLOWED_EXT.has(ext)))) return fail(415, "audio_unsupported");

  const language = resolveLanguage(String(form.get("language") ?? ""));
  if (!language) return fail(400, "bad_language");

  const formatRaw = String(form.get("format") ?? "transcribe");
  if (!FORMATS.includes(formatRaw)) return fail(400, "bad_request");

  let keyterms: string[] = [];
  const ktRaw = form.get("keyterms");
  if (typeof ktRaw === "string" && ktRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(ktRaw);
      if (!Array.isArray(parsed)) return fail(400, "bad_request");
      keyterms = sanitizeKeyterms(parsed.filter((x): x is string => typeof x === "string"), 200, 40);
    } catch {
      return fail(400, "bad_request");
    }
  }

  const seconds = estimateAudioSeconds(bytes, mime || ext);
  if ((mime.includes("wav") || ext === "wav") && seconds > MAX_AUDIO_SECONDS + 0.5) return fail(413, "audio_too_long");
  const reserved = Math.ceil(Math.min(seconds, MAX_AUDIO_SECONDS));
  const budget = limiter.consumeBudget(user.userId, "stt", reserved);
  if (!budget.ok) return limitFail(budget);

  try {
    const r = await transcribe({
      audio: bytes,
      filename,
      mime: mime || "application/octet-stream",
      languageCode: language,
      format: formatRaw as SttFormat,
      keyterms,
      topic: STT_TOPIC,
      previousText: sanitizePreviousText(form.get("previous_text")),
    });
    return NextResponse.json(
      { ok: true, transcript: r.transcript, detectedLanguage: r.detectedLanguage ?? null, requestId: r.requestId },
      { headers: NO_STORE },
    );
  } catch (e) {
    limiter.refundBudget(user.userId, "stt", reserved);
    if (isGnaniError(e)) {
      const c = toClientError(e);
      return fail(c.status, c.code, c.retryable);
    }
    return fail(500, "internal_error");
  }
}

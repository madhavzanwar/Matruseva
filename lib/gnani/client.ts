import "server-only";
import { getGnaniConfig, type GnaniConfig } from "./config";
import { GnaniError, parseGnaniError, redactSecrets } from "./errors";
import { getSharedPool, type KeyPool } from "./pool";
import {
  defaultVoiceFor,
  isGnaniLanguageCode,
  isGnaniTtsLanguage,
  type GnaniLanguageCode,
  type GnaniTtsLanguage,
  type VoiceGender,
} from "./languages";

/**
 * Server-only Gnani (Vachana) client. Public API:
 *   transcribe(input, deps?)  -> { transcript, detectedLanguage?, requestId, processingTime, truncated }
 *   synthesize(input, deps?)  -> { audio: Buffer, contentType }
 * Both validate locally, go through the key pool (queue/retry/circuit breaker),
 * and log ONLY request id / status / latency (never audio, transcripts or text:
 * it is health data). `deps` lets tests inject config, pool and fetch.
 */

export const STT_TIMEOUT_MS = 20_000;
export const TTS_TIMEOUT_MS = 40_000;
export const MAX_TTS_CHARS = 600;
export const MAX_STT_BYTES = 5 * 1024 * 1024;
export const SPEED_MIN = 0.85;
export const SPEED_MAX = 1.15;

const STT_FORMATS = ["verbatim", "transcribe", "codemix", "transliterate"] as const;
export type SttFormat = (typeof STT_FORMATS)[number];
const V3_ONLY_FORMATS = new Set<string>(["codemix", "transliterate"]);

export const TTS_V3_VOICES = {
  female: ["Shivani", "Lakshmi", "Kalpana", "Chetana", "Vasudha", "Riyaa", "Tarika"],
  male: ["Avinash", "Shubham", "Prakash", "Devansh", "Yashraj", "Harshad"],
};
/** Known timbre-v2.5 voices (partial; each has one preferred language). */
export const TTS_V25_VOICES: Record<string, { language: string; gender: VoiceGender }> = {
  Ishaan: { language: "mr-IN", gender: "male" },
  Zahira: { language: "mr-IN", gender: "female" },
  Falak: { language: "gu-IN", gender: "female" },
  Veera: { language: "gu-IN", gender: "male" },
  Ambuja: { language: "hi-IN", gender: "female" },
  Bhavna: { language: "hi-IN", gender: "female" },
  Chitra: { language: "hi-IN", gender: "female" },
};
const V3_SET = new Set([...TTS_V3_VOICES.female, ...TTS_V3_VOICES.male]);
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];
const BITRATES = ["32k", "64k", "96k", "128k", "192k"];

export interface Deps {
  config?: GnaniConfig;
  pool?: KeyPool;
  fetch?: typeof fetch;
}

function setup(deps?: Deps) {
  const config = deps?.config ?? getGnaniConfig();
  if (!config.enabled || config.keys.length === 0) throw new GnaniError({ kind: "not_configured" });
  return { config, pool: deps?.pool ?? getSharedPool(config.keys), doFetch: deps?.fetch ?? fetch };
}

function log(op: string, ctx: { requestId?: string; status?: number | string; ms: number; keyIndex?: number }) {
  console.info(`[gnani] ${op} req=${ctx.requestId ?? "-"} status=${ctx.status ?? "-"} key=#${ctx.keyIndex ?? "-"} ${Math.round(ctx.ms)}ms`);
}

const bad = (code: string, message: string) => new GnaniError({ kind: "bad_request", code, message });

/** Language param for STT: one code, `indic-auto`, or 1-4 comma separated codes (v3.0). */
export function validateSttLanguage(lang: string, model: string): string {
  const v = lang.trim();
  if (isGnaniLanguageCode(v)) return v;
  if (model === "prisma-v3.0") {
    if (v === "indic-auto") return v;
    const parts = v.split(",").map((s) => s.trim());
    if (parts.length >= 1 && parts.length <= 4 && parts.every(isGnaniLanguageCode)) return parts.join(",");
  }
  throw bad("INVALID_LANGUAGE_CODE", "unsupported language");
}

export function sanitizeKeyterms(terms: readonly string[] | undefined, maxTerms = 200, maxLen = 40): string[] {
  if (!terms) return [];
  const out: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== "string") continue;
    const t = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLen).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxTerms) break;
  }
  return out;
}

export interface TranscribeInput {
  audio: Buffer | Uint8Array | Blob;
  filename: string;
  mime: string;
  languageCode: string;
  format?: SttFormat;
  keyterms?: string[];
  topic?: string;
  previousText?: string;
  requestId?: string;
}
export interface TranscribeResult {
  transcript: string;
  detectedLanguage?: string;
  requestId: string;
  processingTime?: number;
  truncated: boolean;
}

export async function transcribe(input: TranscribeInput, deps?: Deps): Promise<TranscribeResult> {
  const { config, pool, doFetch } = setup(deps);
  const model = config.sttModel;
  const language = validateSttLanguage(input.languageCode, model);
  const format = input.format ?? "verbatim";
  if (!(STT_FORMATS as readonly string[]).includes(format)) throw bad("INVALID_FORMAT", "unsupported format");
  if (V3_ONLY_FORMATS.has(format) && model !== "prisma-v3.0") throw bad("INVALID_FORMAT", "format needs prisma-v3.0");
  const blob =
    input.audio instanceof Blob
      ? input.audio
      : new Blob([new Uint8Array(input.audio)], { type: input.mime || "application/octet-stream" });
  if (blob.size === 0) throw new GnaniError({ kind: "audio", code: "EMPTY_AUDIO" });
  if (blob.size > MAX_STT_BYTES) throw new GnaniError({ kind: "audio", code: "MAX_AUDIO_DURATION_EXCEEDED" });
  const keyterms = model === "prisma-v3.0" ? sanitizeKeyterms(input.keyterms) : [];
  const filename = input.filename.replace(/[^\w.\-]/g, "_").slice(0, 80) || "audio";
  const requestId = input.requestId ?? crypto.randomUUID();

  return pool.run(
    async ({ key, keyIndex }) => {
      const form = new FormData();
      form.set("audio_file", blob, filename);
      form.set("model", model);
      form.set("language_code", language);
      form.set("format", format);
      if (keyterms.length) form.set("keyterms", JSON.stringify(keyterms));
      if (model === "prisma-v3.0") {
        if (input.topic) form.set("topic", input.topic.slice(0, 1600));
        if (input.previousText) form.set("previous_text", input.previousText.slice(-600));
      }
      const t0 = performance.now();
      const res = await send(doFetch, `${config.baseUrl}/stt/v3`, key, { method: "POST", body: form }, STT_TIMEOUT_MS, requestId, config.keys);
      const ms = performance.now() - t0;
      const text = await res.text().catch(() => "");
      log("stt", { requestId, status: res.status, ms, keyIndex });
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      const j = json as Record<string, unknown> | undefined;
      if (!res.ok || !j || j.success === false) {
        throw parseGnaniError(res.ok ? 502 : res.status, json ?? "", requestId);
      }
      return {
        transcript: typeof j.transcript === "string" ? j.transcript : "",
        detectedLanguage: typeof j.detected_language_code === "string" ? j.detected_language_code : undefined,
        requestId: typeof j.request_id === "string" ? j.request_id : requestId,
        processingTime: typeof j.processing_time === "number" ? j.processing_time : undefined,
        truncated: j.truncated === true,
      };
    },
    { deadlineMs: 27_000 },
  );
}

export interface SynthesizeInput {
  text: string;
  language: string;
  voice?: string;
  gender?: VoiceGender;
  speed?: number | "slow" | "medium" | "fast";
  container: "mp3" | "ogg" | "wav";
  sampleRate?: number;
  bitrate?: string;
}
export interface SynthesizeResult {
  audio: Buffer;
  contentType: string;
}

/** Pick a voice that belongs to `model`; otherwise fall back to a default (v3: gendered default; v2.5: known voice for the language). */
export function resolveVoice(
  config: Pick<GnaniConfig, "ttsModel" | "voiceFemale" | "voiceMale">,
  language: string,
  voice?: string,
  gender: VoiceGender = "female",
): string {
  const model = config.ttsModel;
  const belongs = (v: string) => (model === "timbre-v3.0" ? V3_SET.has(v) : v in TTS_V25_VOICES);
  if (voice && belongs(voice)) return voice;
  const configured = gender === "male" ? config.voiceMale : config.voiceFemale;
  if (belongs(configured)) return configured;
  if (model === "timbre-v3.0") return defaultVoiceFor(gender);
  const match = Object.entries(TTS_V25_VOICES).find(([, m]) => m.language === language && m.gender === gender)
    ?? Object.entries(TTS_V25_VOICES).find(([, m]) => m.language === language);
  if (match) return match[0];
  throw bad("NO_VOICE_FOR_MODEL", "no voice for model/language");
}

export function clampSpeed(speed: SynthesizeInput["speed"]): number | string | undefined {
  if (speed === undefined) return undefined;
  if (typeof speed === "string") return ["slow", "medium", "fast"].includes(speed) ? speed : undefined;
  if (!Number.isFinite(speed)) return undefined;
  return Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, speed)) * 100) / 100;
}

export async function synthesize(input: SynthesizeInput, deps?: Deps): Promise<SynthesizeResult> {
  const { config, pool, doFetch } = setup(deps);
  const text = (input.text ?? "").trim();
  if (!text) throw bad("EMPTY_TEXT", "text is empty");
  if (text.length > MAX_TTS_CHARS) throw bad("TEXT_TOO_LONG", "split text with splitForTts first");
  if (!isGnaniTtsLanguage(input.language)) throw bad("INVALID_LANGUAGE_CODE", "unsupported language");
  const language: GnaniTtsLanguage = input.language;
  const voice = resolveVoice(config, language, input.voice, input.gender);
  const audioConfig: Record<string, unknown> = { container: input.container };
  const sampleRate = input.sampleRate ?? 24000;
  if (!SAMPLE_RATES.includes(sampleRate)) throw bad("INVALID_SAMPLE_RATE", "unsupported sample rate");
  audioConfig.sample_rate = sampleRate;
  if (input.container === "mp3") {
    const bitrate = input.bitrate ?? "64k";
    if (!BITRATES.includes(bitrate)) throw bad("INVALID_BITRATE", "unsupported bitrate");
    audioConfig.bitrate = bitrate;
  } else if (input.container === "ogg") {
    audioConfig.encoding = "oggopus";
  } else if (input.container === "wav") {
    Object.assign(audioConfig, { encoding: "pcm_s16le", num_channels: 1, sample_width: 2 });
  } else {
    throw bad("INVALID_CONTAINER", "unsupported container");
  }
  const body: Record<string, unknown> = { text, model: config.ttsModel, voice, language, audio_config: audioConfig };
  const speed = clampSpeed(input.speed);
  if (speed !== undefined) body.speed = speed;
  const payload = JSON.stringify(body);
  const requestId = crypto.randomUUID();

  return pool.run(async ({ key, keyIndex }) => {
    const t0 = performance.now();
    const res = await send(
      doFetch,
      `${config.baseUrl}/api/v1/tts/inference`,
      key,
      { method: "POST", body: payload, headers: { "Content-Type": "application/json" } },
      TTS_TIMEOUT_MS,
      requestId,
      config.keys,
    );
    const ms = performance.now() - t0;
    log("tts", { requestId, status: res.status, ms, keyIndex });
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || contentType.includes("json")) {
      const errText = await res.text().catch(() => "");
      throw parseGnaniError(res.ok ? 502 : res.status, errText, requestId);
    }
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) throw new GnaniError({ kind: "upstream", code: "EMPTY_RESPONSE", requestId });
    const fallbackType = input.container === "mp3" ? "audio/mpeg" : `audio/${input.container}`;
    return { audio, contentType: contentType || fallbackType };
  });
}

/** One HTTP attempt with timeout; maps fetch failures to GnaniError without leaking keys. */
async function send(
  doFetch: typeof fetch,
  url: string,
  key: string,
  init: RequestInit,
  timeoutMs: number,
  requestId: string,
  secrets: readonly string[],
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await doFetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { ...(init.headers as Record<string, string> | undefined), "X-API-Key-ID": key, "X-API-Request-ID": requestId },
    });
  } catch (e) {
    const aborted = ctrl.signal.aborted;
    const msg = redactSecrets(e instanceof Error ? e.message : "fetch failed", secrets);
    throw new GnaniError({ kind: aborted ? "timeout" : "network", code: aborted ? "CLIENT_TIMEOUT" : "NETWORK_ERROR", message: msg, requestId });
  } finally {
    clearTimeout(timer);
  }
}

export { type GnaniLanguageCode };

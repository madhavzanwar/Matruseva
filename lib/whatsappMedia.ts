import "server-only";

/**
 * WhatsApp Cloud API (Graph) media + message helpers. Server-only.
 * - fetch is injectable for tests; tokens are never logged or put in error messages;
 * - media content is never logged (it is health data).
 */

export const GRAPH_BASE = "https://graph.facebook.com/v21.0";
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
export const ALLOWED_AUDIO_MIME = ["audio/ogg", "audio/mpeg", "audio/mp4", "audio/aac", "audio/amr", "audio/wav", "audio/x-wav", "audio/webm"];
const META_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

export type WhatsAppMediaErrorCode =
  | "not_configured"
  | "bad_media_id"
  | "http_error"
  | "network"
  | "timeout"
  | "too_large"
  | "unsupported_mime"
  | "bad_response";

export class WhatsAppMediaError extends Error {
  readonly code: WhatsAppMediaErrorCode;
  readonly status: number | undefined;
  constructor(code: WhatsAppMediaErrorCode, status?: number) {
    super(status ? `${code} (HTTP ${status})` : code);
    this.name = "WhatsAppMediaError";
    this.code = code;
    this.status = status;
  }
}

export interface MediaDeps {
  fetch?: typeof fetch;
  token?: string;
}

export interface DownloadedMedia {
  buffer: Buffer;
  mime: string;
  /** file_size reported by Graph (bytes) when present. */
  reportedSize?: number;
}

function resolveToken(token?: string): string {
  const t = token ?? process.env.WHATSAPP_API_TOKEN;
  if (!t) throw new WhatsAppMediaError("not_configured");
  return t;
}

async function timedFetch(doFetch: typeof fetch, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await doFetch(url, { ...init, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new WhatsAppMediaError("timeout");
    void e; // never forward upstream text (could contain URLs/tokens)
    throw new WhatsAppMediaError("network");
  } finally {
    clearTimeout(timer);
  }
}

function baseMime(m: string): string {
  return m.split(";")[0].trim().toLowerCase();
}

export function isAllowedAudioMime(m: string): boolean {
  return ALLOWED_AUDIO_MIME.includes(baseMime(m));
}

/** Two-step Graph download: media id -> short-lived url -> bytes. 5 MB cap, audio mime only. */
export async function downloadWhatsAppMedia(mediaId: string, deps: MediaDeps = {}): Promise<DownloadedMedia> {
  const token = resolveToken(deps.token);
  const doFetch = deps.fetch ?? fetch;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(mediaId)) throw new WhatsAppMediaError("bad_media_id");
  const auth = { Authorization: `Bearer ${token}` };

  const metaRes = await timedFetch(doFetch, `${GRAPH_BASE}/${mediaId}`, { headers: auth }, META_TIMEOUT_MS);
  if (!metaRes.ok) throw new WhatsAppMediaError("http_error", metaRes.status);
  const meta = (await metaRes.json().catch(() => null)) as { url?: unknown; mime_type?: unknown; file_size?: unknown } | null;
  if (!meta || typeof meta.url !== "string") throw new WhatsAppMediaError("bad_response");
  const reportedSize = typeof meta.file_size === "number" ? meta.file_size : undefined;
  const metaMime = typeof meta.mime_type === "string" ? meta.mime_type : "";
  if (metaMime && !isAllowedAudioMime(metaMime)) throw new WhatsAppMediaError("unsupported_mime");
  if (reportedSize !== undefined && reportedSize > MAX_MEDIA_BYTES) throw new WhatsAppMediaError("too_large");

  let host: URL;
  try {
    host = new URL(meta.url);
  } catch {
    throw new WhatsAppMediaError("bad_response");
  }
  if (host.protocol !== "https:") throw new WhatsAppMediaError("bad_response");

  const res = await timedFetch(doFetch, host.toString(), { headers: auth }, DOWNLOAD_TIMEOUT_MS);
  if (!res.ok) throw new WhatsAppMediaError("http_error", res.status);
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) throw new WhatsAppMediaError("too_large");
  const resMime = baseMime(res.headers.get("content-type") ?? "");
  const mime = metaMime ? baseMime(metaMime) : resMime;
  if (!mime || !isAllowedAudioMime(mime)) throw new WhatsAppMediaError("unsupported_mime");

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new WhatsAppMediaError("too_large");
  if (buffer.length === 0) throw new WhatsAppMediaError("bad_response");
  return { buffer, mime, reportedSize };
}

export interface SendDeps extends MediaDeps {
  phoneNumberId?: string;
}

function resolvePhoneId(id?: string): string {
  const v = id ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!v || !/^\d{5,25}$/.test(v)) throw new WhatsAppMediaError("not_configured");
  return v;
}

/** Whether replies can be sent (token + phone number id present). */
export function canSendWhatsApp(): boolean {
  return Boolean(process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function postMessage(to: string, payload: Record<string, unknown>, deps: SendDeps): Promise<void> {
  const token = resolveToken(deps.token);
  const phoneId = resolvePhoneId(deps.phoneNumberId);
  const res = await timedFetch(
    deps.fetch ?? fetch,
    `${GRAPH_BASE}/${phoneId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
    },
    META_TIMEOUT_MS,
  );
  if (!res.ok) throw new WhatsAppMediaError("http_error", res.status);
}

export function sendWhatsAppText(to: string, text: string, deps: SendDeps = {}): Promise<void> {
  return postMessage(to, { type: "text", text: { body: text } }, deps);
}

export function sendWhatsAppAudio(to: string, mediaId: string, deps: SendDeps = {}): Promise<void> {
  return postMessage(to, { type: "audio", audio: { id: mediaId } }, deps);
}

/** Uploads audio to the Graph media store and returns the media id. */
export async function uploadWhatsAppAudio(buffer: Uint8Array, mime: string, deps: SendDeps = {}): Promise<string> {
  const token = resolveToken(deps.token);
  const phoneId = resolvePhoneId(deps.phoneNumberId);
  const type = baseMime(mime) || "audio/ogg";
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", type);
  form.set("file", new Blob([new Uint8Array(buffer)], { type }), type === "audio/ogg" ? "reply.ogg" : "reply.audio");
  const res = await timedFetch(
    deps.fetch ?? fetch,
    `${GRAPH_BASE}/${phoneId}/media`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form },
    DOWNLOAD_TIMEOUT_MS,
  );
  if (!res.ok) throw new WhatsAppMediaError("http_error", res.status);
  const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
  if (!json || typeof json.id !== "string") throw new WhatsAppMediaError("bad_response");
  return json.id;
}

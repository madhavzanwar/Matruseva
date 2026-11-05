// Gnani error model. Plain module (no secrets) so it can be unit-tested and
// shared; routes translate a GnaniError into HTTP via toHttpStatus/toClientCode
// and NEVER forward `message` (upstream text) to the browser.

export type GnaniErrorKind =
  | "not_configured"
  | "auth" // 401: bad/missing key
  | "credit" // 402: out of credit
  | "forbidden" // 403: key lacks scope
  | "rate_limited" // 429 or our own queue limits
  | "bad_request" // other 4xx: our request was wrong
  | "audio" // the audio itself is unusable (too long / unsupported / empty)
  | "timeout" // our timeout or upstream 504
  | "upstream" // 5xx
  | "network"; // connection errors

export interface GnaniErrorInit {
  kind: GnaniErrorKind;
  status?: number;
  /** Upstream machine code, e.g. INVALID_API_KEY, EMPTY_AUDIO. Or a local one (QUEUE_FULL). */
  code?: string;
  message?: string;
  retryable?: boolean;
  requestId?: string;
}

const RETRYABLE_BY_KIND: Record<GnaniErrorKind, boolean> = {
  not_configured: false,
  auth: false,
  credit: false,
  forbidden: false,
  rate_limited: true,
  bad_request: false,
  audio: false,
  timeout: true,
  upstream: true,
  network: true,
};

export class GnaniError extends Error {
  readonly kind: GnaniErrorKind;
  readonly status: number | undefined;
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;

  constructor(init: GnaniErrorInit) {
    super(truncate(init.message ?? init.code ?? init.kind, 200));
    this.name = "GnaniError";
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code ?? init.kind.toUpperCase();
    this.retryable = init.retryable ?? RETRYABLE_BY_KIND[init.kind];
    this.requestId = init.requestId;
  }
}

export function isGnaniError(e: unknown): e is GnaniError {
  return e instanceof GnaniError;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Remove any occurrence of the given secrets from a string (defence in depth for logs/messages). */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  return out;
}

const AUDIO_CODES = new Set([
  "EMPTY_AUDIO",
  "UNSUPPORTED_AUDIO_FORMAT",
  "AUDIO_CONVERSION_ERROR",
  "MAX_AUDIO_DURATION_EXCEEDED",
]);

interface Extracted {
  code?: string;
  message?: string;
}

/** Pull (code, message) out of every documented error body shape. */
function extract(body: unknown): Extracted {
  if (typeof body === "string") return { message: body };
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  // {"detail": {"error_code","message","status_code"}}  (auth / rate / credit / scope)
  const detail = b.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    return { code: str(d.error_code) ?? str(d.code), message: str(d.message) };
  }
  // {"detail": [ {...}, ... ]}  (422 validation) -- message left generic, may echo input
  if (Array.isArray(detail)) return { code: "VALIDATION_ERROR", message: "request validation failed" };
  if (typeof detail === "string") return { message: detail };

  // {"success":false,"error":{"type","message"}}  (STT)
  const err = b.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    return { code: str(e.type) ?? str(e.code), message: str(e.message) };
  }
  // {"error":"Gateway Timeout","code":"UPSTREAM_TIMEOUT","message":"..."}  (504)
  if (typeof err === "string") return { code: str(b.code), message: str(b.message) ?? err };

  // {"success":false,"message","status_code"}  (TTS)
  return { code: str(b.code) ?? str(b.error_code), message: str(b.message) };
}

/**
 * Build a GnaniError from an HTTP error response. `body` may be parsed JSON or
 * raw text (non-JSON proxies/gateways). Never throws.
 */
export function parseGnaniError(status: number, body: unknown, requestId?: string): GnaniError {
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }
  }
  const { code, message } = extract(parsed);
  const base = { status, code, message: message ?? `HTTP ${status}`, requestId };

  if (status === 401) return new GnaniError({ ...base, kind: "auth" });
  if (status === 402) return new GnaniError({ ...base, kind: "credit", code: code ?? "INSUFFICIENT_CREDIT" });
  if (status === 403) return new GnaniError({ ...base, kind: "forbidden" });
  if (status === 429) return new GnaniError({ ...base, kind: "rate_limited", code: code ?? "RATE_LIMITED" });
  if (status === 504 || code === "UPSTREAM_TIMEOUT") return new GnaniError({ ...base, kind: "timeout" });
  if (status === 413) return new GnaniError({ ...base, kind: "audio", code: code ?? "MAX_AUDIO_DURATION_EXCEEDED" });
  if (status >= 500) return new GnaniError({ ...base, kind: "upstream" });
  if (status === 422) return new GnaniError({ ...base, kind: "bad_request", code: code ?? "VALIDATION_ERROR" });
  if (code && AUDIO_CODES.has(code)) return new GnaniError({ ...base, kind: "audio" });
  return new GnaniError({ ...base, kind: "bad_request" });
}

export interface ClientError {
  /** HTTP status the route should answer with. */
  status: number;
  /** Stable machine code for the browser (never translated text). */
  code: string;
  /** Whether trying again later (or falling back to the browser) is sensible. */
  retryable: boolean;
}

const LANGUAGE_CODES = new Set(["INVALID_LANGUAGE_CODE", "MODEL_UNSUPPORTED_LANGUAGE"]);

/**
 * Stable mapping GnaniError -> client-facing {status, code}.
 *
 *  kind                 HTTP  code
 *  not_configured       503   gnani_not_configured
 *  auth/credit/forbidden 503  gnani_unavailable   (client falls back to browser)
 *  rate_limited         503   gnani_unavailable   (retries/queue exhausted)
 *  upstream, network    502   gnani_unavailable
 *  timeout              504   gnani_unavailable
 *  audio MAX_AUDIO_..   413   audio_too_long
 *  audio EMPTY_AUDIO    400   audio_empty
 *  audio other          415   audio_unsupported
 *  bad_request language 400   bad_language
 *  bad_request other    400   bad_request  (INVALID_MODEL/FORMAT/CONTEXT are our bug -> 503 gnani_unavailable)
 */
export function toClientError(err: GnaniError): ClientError {
  const unavailable = (status: number): ClientError => ({ status, code: "gnani_unavailable", retryable: true });
  switch (err.kind) {
    case "not_configured":
      return { status: 503, code: "gnani_not_configured", retryable: false };
    case "auth":
    case "credit":
    case "forbidden":
    case "rate_limited":
      return unavailable(503);
    case "upstream":
    case "network":
      return unavailable(502);
    case "timeout":
      return unavailable(504);
    case "audio":
      if (err.code === "MAX_AUDIO_DURATION_EXCEEDED") return { status: 413, code: "audio_too_long", retryable: false };
      if (err.code === "EMPTY_AUDIO") return { status: 400, code: "audio_empty", retryable: false };
      return { status: 415, code: "audio_unsupported", retryable: false };
    case "bad_request":
      if (LANGUAGE_CODES.has(err.code)) return { status: 400, code: "bad_language", retryable: false };
      if (err.code === "INVALID_MODEL" || err.code === "INVALID_FORMAT" || err.code === "INVALID_CONTEXT") {
        return { status: 503, code: "gnani_unavailable", retryable: false };
      }
      return { status: 400, code: "bad_request", retryable: false };
  }
}

export const toHttpStatus = (err: GnaniError): number => toClientError(err).status;
export const toClientCode = (err: GnaniError): string => toClientError(err).code;

import { describe, it, expect } from "vitest";
import { parseGnaniError, toClientError, redactSecrets } from "./errors";

describe("parseGnaniError", () => {
  it("auth/credit/scope/rate detail shape", () => {
    const d = (code: string | undefined, status: number) => ({ detail: { error_code: code, message: "m", status_code: status } });
    expect(parseGnaniError(401, d("INVALID_API_KEY", 401))).toMatchObject({ kind: "auth", code: "INVALID_API_KEY", retryable: false });
    expect(parseGnaniError(401, d("MISSING_API_KEY", 401)).code).toBe("MISSING_API_KEY");
    expect(parseGnaniError(402, d(undefined, 402))).toMatchObject({ kind: "credit", retryable: false });
    expect(parseGnaniError(403, d("SCOPE_NOT_ALLOWED", 403)).kind).toBe("forbidden");
    expect(parseGnaniError(429, d("RATE_LIMITED", 429))).toMatchObject({ kind: "rate_limited", retryable: true });
  });
  it("STT error shape", () => {
    const e = (type: string) => ({ success: false, error: { type, message: "x" } });
    expect(parseGnaniError(400, e("EMPTY_AUDIO")).kind).toBe("audio");
    expect(parseGnaniError(400, e("MAX_AUDIO_DURATION_EXCEEDED")).kind).toBe("audio");
    expect(parseGnaniError(400, e("INVALID_LANGUAGE_CODE"))).toMatchObject({ kind: "bad_request", code: "INVALID_LANGUAGE_CODE" });
    expect(parseGnaniError(500, e("TRANSCRIPTION_FAILED"))).toMatchObject({ kind: "upstream", retryable: true });
    expect(parseGnaniError(503, e("SERVICE_UNAVAILABLE")).kind).toBe("upstream");
  });
  it("504 gateway shape and 422 validation", () => {
    expect(parseGnaniError(504, { error: "Gateway Timeout", code: "UPSTREAM_TIMEOUT", message: "t" })).toMatchObject({ kind: "timeout", code: "UPSTREAM_TIMEOUT", retryable: true });
    const v = parseGnaniError(422, { detail: [{ loc: ["body"], msg: "secret input" }] });
    expect(v).toMatchObject({ kind: "bad_request", code: "VALIDATION_ERROR" });
    expect(v.message).not.toContain("secret input");
  });
  it("TTS shape and non-JSON bodies", () => {
    expect(parseGnaniError(400, { success: false, message: "bad voice", status_code: 400 })).toMatchObject({ kind: "bad_request" });
    expect(parseGnaniError(502, "<html>bad gateway</html>").kind).toBe("upstream");
    expect(parseGnaniError(500, undefined).kind).toBe("upstream");
  });
  it("redacts secrets", () => {
    expect(redactSecrets("key abc12345 here", ["abc12345"])).toBe("key [redacted] here");
  });
});

describe("toClientError", () => {
  const map = (status: number, body: unknown) => toClientError(parseGnaniError(status, body));
  it("maps to stable codes", () => {
    expect(map(401, {})).toMatchObject({ status: 503, code: "gnani_unavailable" });
    expect(map(402, {})).toMatchObject({ status: 503, code: "gnani_unavailable" });
    expect(map(403, {}).code).toBe("gnani_unavailable");
    expect(map(429, {}).code).toBe("gnani_unavailable");
    expect(map(500, {})).toMatchObject({ status: 502, code: "gnani_unavailable" });
    expect(map(504, {})).toMatchObject({ status: 504, code: "gnani_unavailable" });
    const stt = (t: string) => ({ success: false, error: { type: t, message: "" } });
    expect(map(400, stt("MAX_AUDIO_DURATION_EXCEEDED"))).toMatchObject({ status: 413, code: "audio_too_long" });
    expect(map(400, stt("EMPTY_AUDIO"))).toMatchObject({ status: 400, code: "audio_empty" });
    expect(map(400, stt("UNSUPPORTED_AUDIO_FORMAT"))).toMatchObject({ status: 415, code: "audio_unsupported" });
    expect(map(400, stt("AUDIO_CONVERSION_ERROR")).code).toBe("audio_unsupported");
    expect(map(400, stt("INVALID_LANGUAGE_CODE")).code).toBe("bad_language");
    expect(map(400, stt("MODEL_UNSUPPORTED_LANGUAGE")).code).toBe("bad_language");
    expect(map(400, stt("INVALID_MODEL")).code).toBe("gnani_unavailable");
    expect(map(422, { detail: [] })).toMatchObject({ status: 400, code: "bad_request" });
  });
});

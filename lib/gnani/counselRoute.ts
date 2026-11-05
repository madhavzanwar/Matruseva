import "server-only";
import { NextResponse } from "next/server";
import { COUNSELING_LANGUAGES, type CounselingLanguage, type CounselingPatientData } from "@/lib/voiceCounselor";
import { getGnaniConfig } from "./config";
import { isGnaniError, toClientError } from "./errors";
import {
  CounselLimitError,
  CounselPartError,
  getCounselAudioPart,
  getCounselManifest,
  type CounselAudioDeps,
} from "./counselAudio";
import { getLimiter } from "./limits";

/**
 * Shared HTTP plumbing for the two counselling-audio routes
 * (staff: /api/gnani/tts/counsel, mother: /listen/[token]/audio).
 * Error body: { ok:false, code, retryable } (codes from lib/gnani/errors.ts toClientError plus
 * unauthenticated | bad_request | bad_language | patient_not_found | rate_limited | budget_exceeded | internal_error).
 * `gnani_not_configured` / `gnani_unavailable` mean "play the browser voice instead".
 */

export const NO_STORE = "private, no-store";
export const AUDIO_CACHE = "private, max-age=3600, immutable";
const MAX_PART_INDEX = 999;

export function counselFail(
  status: number,
  code: string,
  retryable = false,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ ok: false, code, retryable }, { status, headers: { "Cache-Control": NO_STORE, ...headers } });
}

export function isCounselLanguage(v: unknown): v is CounselingLanguage {
  return typeof v === "string" && COUNSELING_LANGUAGES.some((l) => l.code === v);
}

/** null => manifest request; number => part; "invalid" => 400. Digits only (no sign, decimal, exponent, NaN). */
export function parsePartParam(raw: string | null): number | null | "invalid" {
  if (raw === null) return null;
  if (!/^\d{1,3}$/.test(raw)) return "invalid";
  const n = Number(raw);
  return n <= MAX_PART_INDEX ? n : "invalid";
}

/** Single byte-range support: iOS Safari's <audio> requires 206 responses. */
function audioResponse(audio: Buffer, rangeHeader: string | null): Response {
  const total = audio.length;
  const base: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": AUDIO_CACHE,
    "X-Content-Type-Options": "nosniff",
  };
  const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start: number;
    let end: number;
    if (m[1] === "") {
      const suffix = Number(m[2]);
      start = Math.max(0, total - suffix);
      end = total - 1;
    } else {
      start = Number(m[1]);
      end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
    }
    if (start >= total || start > end || (m[1] === "" && Number(m[2]) === 0)) {
      return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${total}`, "Cache-Control": NO_STORE } });
    }
    const slice = audio.subarray(start, end + 1);
    return new Response(new Uint8Array(slice) as BodyInit, {
      status: 206,
      headers: { ...base, "Content-Length": String(slice.length), "Content-Range": `bytes ${start}-${end}/${total}` },
    });
  }
  return new Response(new Uint8Array(audio) as BodyInit, { status: 200, headers: { ...base, "Content-Length": String(total) } });
}

export interface CounselRequestInput {
  request: Request;
  lang: CounselingLanguage;
  /** Already-validated part: null => manifest. */
  part: number | null;
  /** Rate-limit + TTS-budget identity: user id (staff) or `public:${patientId}` (mother). */
  budgetKey: string;
  /** Loads the minimal patient data; null => not found (staff: other clinic, too). */
  load: () => Promise<CounselingPatientData | null>;
  /** Response used when the patient cannot be loaded. */
  notFound: () => Response;
  deps?: CounselAudioDeps;
}

export async function respondCounsel(input: CounselRequestInput): Promise<Response> {
  const config = getGnaniConfig();
  if (!config.enabled || config.keys.length === 0) return counselFail(503, "gnani_not_configured");

  let data: CounselingPatientData | null;
  try {
    data = await input.load();
  } catch {
    return counselFail(500, "internal_error");
  }
  if (!data) return input.notFound();

  const deps: CounselAudioDeps = { ...input.deps, budgetKey: input.budgetKey };
  try {
    if (input.part === null) {
      // Manifests are cheap but hit the database: keep a per-identity rate limit on them.
      const rate = (deps.limiter ?? getLimiter()).checkRate(input.budgetKey, "tts");
      if (!rate.ok) return counselFail(429, rate.code, true, { "Retry-After": String(rate.retryAfterSec) });
      const m = getCounselManifest(data, input.lang, deps);
      // Deliberately minimal: no patient fields, no text, no voice/model.
      return NextResponse.json(
        { ok: true, parts: m.parts, language: m.language, version: m.version },
        { headers: { "Cache-Control": NO_STORE } },
      );
    }
    const r = await getCounselAudioPart(data, input.lang, input.part, deps);
    return audioResponse(r.audio, input.request.headers.get("range"));
  } catch (e) {
    if (e instanceof CounselLimitError) {
      return counselFail(429, e.code, true, { "Retry-After": String(e.retryAfterSec) });
    }
    if (e instanceof CounselPartError) return counselFail(400, "bad_request");
    if (isGnaniError(e)) {
      const c = toClientError(e);
      return counselFail(c.status, c.code, c.retryable);
    }
    return counselFail(500, "internal_error");
  }
}

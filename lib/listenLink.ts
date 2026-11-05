import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isDemoModeEnabled, isSupabaseConfigured } from "@/lib/demo";
import { COUNSELING_LANGUAGES, type CounselingLanguage } from "@/lib/voiceCounselor";

/**
 * Signed, expiring, public "listen" links for mothers.
 *
 * Token format: base64url(JSON {p: patientId, l: lang, e: expiryUnixSeconds}) + "." + base64url(HMAC-SHA256(secret, payloadPart))
 * The token is a bearer capability: anyone holding it can open that one patient's
 * counselling page until it expires. It is signed, not encrypted — it carries only
 * the patient id, language and expiry.
 */

export const LISTEN_LINK_DEFAULT_TTL_SECONDS = 14 * 24 * 60 * 60;

// Used ONLY for the pure offline demo (DEMO_MODE=1 and Supabase not configured). Never applies in production.
const DEMO_DEV_SECRET = "matrusetu-demo-only-listen-link-secret";

export class ListenLinkConfigError extends Error {
  constructor() {
    super("LISTEN_LINK_SECRET is not configured");
    this.name = "ListenLinkConfigError";
  }
}

export interface ListenLinkPayload {
  patientId: string;
  lang: CounselingLanguage;
  /** Expiry, unix seconds. */
  exp: number;
}

function getSecret(): string {
  const secret = process.env.LISTEN_LINK_SECRET;
  if (secret) return secret;
  if (isDemoModeEnabled() && !isSupabaseConfigured()) return DEMO_DEV_SECRET;
  throw new ListenLinkConfigError();
}

function sign(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

export function createListenToken(
  patientId: string,
  lang: CounselingLanguage,
  ttlSeconds: number = LISTEN_LINK_DEFAULT_TTL_SECONDS,
  nowMs: number = Date.now()
): string {
  const secret = getSecret(); // throws when unset (fail closed)
  const exp = Math.floor(nowMs / 1000) + ttlSeconds;
  const payloadPart = Buffer.from(JSON.stringify({ p: patientId, l: lang, e: exp })).toString("base64url");
  return `${payloadPart}.${sign(payloadPart, secret).toString("base64url")}`;
}

/** Returns the payload for a genuine, unexpired token; null for anything else (including missing secret). */
export function verifyListenToken(token: string, nowMs: number = Date.now()): ListenLinkPayload | null {
  try {
    if (typeof token !== "string" || token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [payloadPart, sigPart] = parts;

    const expected = sign(payloadPart, getSecret());
    const given = Buffer.from(sigPart, "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    const raw = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as { p?: unknown; l?: unknown; e?: unknown };
    if (typeof raw.p !== "string" || !raw.p || typeof raw.e !== "number" || !Number.isFinite(raw.e)) return null;
    if (!COUNSELING_LANGUAGES.some((l) => l.code === raw.l)) return null;
    if (raw.e <= Math.floor(nowMs / 1000)) return null;

    return { patientId: raw.p, lang: raw.l as CounselingLanguage, exp: raw.e };
  } catch {
    return null;
  }
}

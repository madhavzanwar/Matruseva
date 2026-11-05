import "server-only";
import { DEFAULT_VOICE_FEMALE, DEFAULT_VOICE_MALE } from "./languages";

// Server-only Gnani configuration. Reads process.env on every call (cheap) so
// tests and env changes take effect. Keys never leave the server: do not
// return GnaniConfig (or its `keys`) from a route, and never log it.

export const STT_MODELS = ["prisma-v3.0", "prisma-v2.5"] as const;
export const TTS_MODELS = ["timbre-v3.0", "timbre-v2.5"] as const;
export type SttModel = (typeof STT_MODELS)[number];
export type TtsModel = (typeof TTS_MODELS)[number];

export const DEFAULT_BASE_URL = "https://api.vachana.ai";

export interface GnaniLimitsConfig {
  sttPerMinute: number;
  ttsPerMinute: number;
  sttDailySecondsPerUser: number;
  ttsDailyCharsPerUser: number;
  sttDailySecondsGlobal: number;
  ttsDailyCharsGlobal: number;
}

export interface GnaniConfig {
  /** false when GNANI_ENABLED=0 (kill switch). */
  enabled: boolean;
  keys: string[];
  baseUrl: string;
  sttModel: SttModel;
  ttsModel: TtsModel;
  voiceFemale: string;
  voiceMale: string;
  limits: GnaniLimitsConfig;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = raw?.trim();
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function parseKeys(pool: string | undefined, single: string | undefined): string[] {
  const all = `${pool ?? ""},${single ?? ""}`
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

function parseBaseUrl(raw: string | undefined): string {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return DEFAULT_BASE_URL;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function getGnaniConfig(): GnaniConfig {
  const env = process.env;
  const flag = env.GNANI_ENABLED?.trim().toLowerCase();
  return {
    enabled: flag !== "0" && flag !== "false",
    keys: parseKeys(env.GNANI_API_KEYS, env.GNANI_API_KEY),
    baseUrl: parseBaseUrl(env.GNANI_BASE_URL),
    sttModel: pick(env.GNANI_STT_MODEL, STT_MODELS, "prisma-v3.0"),
    ttsModel: pick(env.GNANI_TTS_MODEL, TTS_MODELS, "timbre-v3.0"),
    voiceFemale: env.GNANI_TTS_VOICE_FEMALE?.trim() || DEFAULT_VOICE_FEMALE,
    voiceMale: env.GNANI_TTS_VOICE_MALE?.trim() || DEFAULT_VOICE_MALE,
    limits: {
      sttPerMinute: int("GNANI_STT_PER_MINUTE", 20),
      ttsPerMinute: int("GNANI_TTS_PER_MINUTE", 60),
      sttDailySecondsPerUser: int("GNANI_STT_DAILY_SECONDS_PER_USER", 1800),
      ttsDailyCharsPerUser: int("GNANI_TTS_DAILY_CHARS_PER_USER", 30000),
      sttDailySecondsGlobal: int("GNANI_STT_DAILY_SECONDS_GLOBAL", 7200),
      ttsDailyCharsGlobal: int("GNANI_TTS_DAILY_CHARS_GLOBAL", 200000),
    },
  };
}

/** True when the feature is switched on AND at least one key exists. */
export function isGnaniConfigured(): boolean {
  const c = getGnaniConfig();
  return c.enabled && c.keys.length > 0;
}

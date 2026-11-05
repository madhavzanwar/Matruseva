import "server-only";
import { createHash } from "node:crypto";
import { generateCounseling, type CounselingLanguage, type CounselingPatientData } from "@/lib/voiceCounselor";
import { isSupabaseConfigured } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGnaniConfig, type GnaniConfig } from "./config";
import { resolveVoice, synthesize, type SynthesizeInput, type SynthesizeResult } from "./client";
import { splitForTts, toGnaniLanguage } from "./languages";
import { getLimiter, type GnaniLimiter } from "./limits";
import { ttsCacheKey } from "./ttsCacheKey";

/**
 * Counselling audio via Gnani Timbre, built ONLY from server-side patient data.
 *
 *   text  = generateCounseling(data, lang).speechText  (clinician-reviewed, unchanged)
 *   parts = splitForTts(text, 350)                      (TTS 500s on overlong text)
 *   key   = ttsCacheKey(part text, voice, language, model, speed 1, mp3)
 *
 * Callers can only choose (patient, language, part index): never the text.
 * Cache layers, in order: in-memory LRU -> private Storage bucket `tts-audio`
 * (service role) -> Gnani. Credits (the daily TTS char budget) are consumed
 * ONLY on a full miss. A cache read/write failure never blocks serving audio.
 * Playback speed is applied in the player (playbackRate) so keys stay stable.
 */

export const COUNSEL_PART_MAX_CHARS = 350;
export const TTS_BUCKET = "tts-audio";
export const MEMORY_CACHE_PARTS = 50;
const COUNSEL_SPEED = 1.0;
const COUNSEL_CONTAINER = "mp3" as const;
export const COUNSEL_CONTENT_TYPE = "audio/mpeg";

export interface CounselManifest {
  parts: number;
  language: CounselingLanguage;
  voice: string;
  model: string;
  /** Opaque content version (hash of the part cache keys): lets the browser cache parts safely and drop them when advice changes. */
  version: string;
}
export interface CounselAudioPart {
  audio: Buffer;
  contentType: string;
  cacheHit: boolean;
}

/** Our own rate/budget refusal, mapped by routes to HTTP 429 (+ Retry-After). */
export class CounselLimitError extends Error {
  constructor(
    readonly code: "rate_limited" | "budget_exceeded",
    readonly retryAfterSec: number,
  ) {
    super(code);
    this.name = "CounselLimitError";
  }
}
/** Part index out of range / not an integer. */
export class CounselPartError extends Error {
  constructor() {
    super("part_out_of_range");
    this.name = "CounselPartError";
  }
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

/** Tiny insertion/recency-ordered LRU. */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

/** Durable cache layer (Supabase Storage in production). */
export interface AudioStore {
  get(key: string): Promise<Buffer | null>;
  put(key: string, audio: Buffer): Promise<void>;
}

const objectPath = (key: string) => `${key.slice(0, 2)}/${key}.mp3`;

/** Private `tts-audio` bucket through the service-role client. null when Supabase is not configured. */
export function createSupabaseAudioStore(): AudioStore | null {
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    async get(key) {
      const { data, error } = await createAdminClient().storage.from(TTS_BUCKET).download(objectPath(key));
      if (error || !data) return null; // not found or unreadable: treat as a miss
      const buf = Buffer.from(await data.arrayBuffer());
      return buf.length > 0 ? buf : null;
    },
    async put(key, audio) {
      const { error } = await createAdminClient()
        .storage.from(TTS_BUCKET)
        .upload(objectPath(key), audio, { contentType: COUNSEL_CONTENT_TYPE, upsert: true });
      if (error) throw new Error("storage upload failed");
    },
  };
}

const sharedMemory = new LruCache<Buffer>(MEMORY_CACHE_PARTS);
const inflight = new Map<string, Promise<Buffer>>();
let defaultStore: AudioStore | null | undefined;

/** Test helper: forget process-wide cache state. */
export function resetCounselAudioCache(): void {
  sharedMemory.clear();
  inflight.clear();
  defaultStore = undefined;
}

export interface CounselAudioDeps {
  /** Defaults to the Gnani client. Inject a fake in tests (no network). */
  synthesize?: (input: SynthesizeInput) => Promise<SynthesizeResult>;
  config?: GnaniConfig;
  limiter?: GnaniLimiter;
  /** Durable cache; `null` disables it, undefined = Supabase Storage when configured. */
  store?: AudioStore | null;
  memory?: LruCache<Buffer>;
  /** Who pays the TTS budget / rate limit: staff user id, or `public:${patientId}`. */
  budgetKey?: string;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface Plan {
  chunks: string[];
  keys: string[];
  language: string;
  voice: string;
  model: string;
  version: string;
}

function plan(data: CounselingPatientData, lang: CounselingLanguage, config: GnaniConfig): Plan {
  const language = toGnaniLanguage(lang);
  if (!language) throw new CounselPartError();
  const chunks = splitForTts(generateCounseling(data, lang).speechText, COUNSEL_PART_MAX_CHARS);
  const voice = resolveVoice(config, language, undefined, "female");
  const model = config.ttsModel;
  const keys = chunks.map((text) =>
    ttsCacheKey({ text, voice, language, model, speed: COUNSEL_SPEED, container: COUNSEL_CONTAINER }),
  );
  const version = createHash("sha256").update(keys.join("|")).digest("hex").slice(0, 16);
  return { chunks, keys, language, voice, model, version };
}

export function getCounselManifest(
  data: CounselingPatientData,
  lang: CounselingLanguage,
  deps: Pick<CounselAudioDeps, "config"> = {},
): CounselManifest {
  const p = plan(data, lang, deps.config ?? getGnaniConfig());
  return { parts: p.chunks.length, language: lang, voice: p.voice, model: p.model, version: p.version };
}

// ---------------------------------------------------------------------------
// Part retrieval
// ---------------------------------------------------------------------------

export async function getCounselAudioPart(
  data: CounselingPatientData,
  lang: CounselingLanguage,
  partIndex: number,
  deps: CounselAudioDeps = {},
): Promise<CounselAudioPart> {
  const config = deps.config ?? getGnaniConfig();
  const p = plan(data, lang, config);
  if (!Number.isInteger(partIndex) || partIndex < 0 || partIndex >= p.chunks.length) throw new CounselPartError();

  const key = p.keys[partIndex];
  const text = p.chunks[partIndex];
  const memory = deps.memory ?? sharedMemory;
  const hit = (audio: Buffer): CounselAudioPart => ({ audio, contentType: COUNSEL_CONTENT_TYPE, cacheHit: true });

  const inMemory = memory.get(key);
  if (inMemory) return hit(inMemory);

  if (defaultStore === undefined && deps.store === undefined) defaultStore = createSupabaseAudioStore();
  const store = deps.store === undefined ? (defaultStore ?? null) : deps.store;
  if (store) {
    try {
      const stored = await store.get(key);
      if (stored) {
        memory.set(key, stored);
        return hit(stored);
      }
    } catch {
      /* unreadable cache == miss; never fail the request because of it */
    }
  }

  // A concurrent identical miss (prefetch + play, two tabs) shares one synthesis and one budget charge.
  const pending = inflight.get(key);
  if (pending) return hit(await pending);

  const run = (async (): Promise<Buffer> => {
    const limiter = deps.limiter ?? getLimiter();
    const budgetKey = deps.budgetKey ?? `public:${data.patientId}`;
    const rate = limiter.checkRate(budgetKey, "tts");
    if (!rate.ok) throw new CounselLimitError(rate.code, rate.retryAfterSec);
    const budget = limiter.consumeBudget(budgetKey, "tts", text.length);
    if (!budget.ok) throw new CounselLimitError(budget.code, budget.retryAfterSec);

    let audio: Buffer;
    try {
      const synth = deps.synthesize ?? ((input: SynthesizeInput) => synthesize(input, deps.config ? { config: deps.config } : undefined));
      const result = await synth({
        text,
        language: p.language,
        voice: p.voice,
        gender: "female",
        speed: COUNSEL_SPEED,
        container: COUNSEL_CONTAINER,
      });
      audio = result.audio;
    } catch (e) {
      limiter.refundBudget(budgetKey, "tts", text.length);
      throw e;
    }

    memory.set(key, audio);
    if (store) {
      try {
        await store.put(key, audio);
      } catch {
        /* serve the freshly synthesised audio even if it could not be cached */
      }
    }
    return audio;
  })();

  inflight.set(key, run);
  try {
    const audio = await run;
    return { audio, contentType: COUNSEL_CONTENT_TYPE, cacheHit: false };
  } finally {
    inflight.delete(key);
  }
}

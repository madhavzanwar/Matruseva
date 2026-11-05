import { getGnaniConfig, type GnaniLimitsConfig } from "./config";

/**
 * Lightweight in-memory per-user rate limiter + approximate daily budgets
 * (STT audio seconds, TTS characters). Protects the small hackathon credit
 * allowance from one user or a runaway client loop. Per-instance memory only
 * (resets on restart / not shared across serverless instances): a guard rail,
 * not billing-grade accounting.
 *
 * Routes translate a failed result to HTTP 429 with `code`:
 *   rate_limited | budget_exceeded   (+ Retry-After from retryAfterSec).
 */

export type UsageKind = "stt" | "tts";
export type LimitResult = { ok: true } | { ok: false; code: "rate_limited" | "budget_exceeded"; retryAfterSec: number };

const MINUTE = 60_000;

export class GnaniLimiter {
  private windows = new Map<string, number[]>();
  private day = "";
  private userUsage = new Map<string, number>();
  private globalUsage: Record<UsageKind, number> = { stt: 0, tts: 0 };

  constructor(
    private readonly getLimits: () => GnaniLimitsConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private rollDay(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.userUsage.clear();
      this.globalUsage = { stt: 0, tts: 0 };
    }
  }

  private secondsToMidnight(): number {
    const n = new Date(this.now());
    const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
    return Math.max(1, Math.ceil((next - n.getTime()) / 1000));
  }

  /** Sliding window: records the hit when allowed. */
  checkRate(userId: string, kind: UsageKind): LimitResult {
    const L = this.getLimits();
    const max = kind === "stt" ? L.sttPerMinute : L.ttsPerMinute;
    const now = this.now();
    const id = `${kind}:${userId}`;
    const hits = (this.windows.get(id) ?? []).filter((t) => now - t < MINUTE);
    if (hits.length >= max) {
      this.windows.set(id, hits);
      return { ok: false, code: "rate_limited", retryAfterSec: Math.max(1, Math.ceil((hits[0] + MINUTE - now) / 1000)) };
    }
    hits.push(now);
    this.windows.set(id, hits);
    if (this.windows.size > 5000) {
      for (const [k, v] of this.windows) if (!v.some((t) => now - t < MINUTE)) this.windows.delete(k);
    }
    return { ok: true };
  }

  private caps(kind: UsageKind) {
    const L = this.getLimits();
    return kind === "stt"
      ? { user: L.sttDailySecondsPerUser, global: L.sttDailySecondsGlobal }
      : { user: L.ttsDailyCharsPerUser, global: L.ttsDailyCharsGlobal };
  }

  /** Reserve `amount` (seconds for stt, chars for tts); fails if the user or global daily cap would be exceeded. */
  consumeBudget(userId: string, kind: UsageKind, amount: number): LimitResult {
    this.rollDay();
    const caps = this.caps(kind);
    const k = `${kind}:${userId}`;
    const used = this.userUsage.get(k) ?? 0;
    if (used + amount > caps.user || this.globalUsage[kind] + amount > caps.global) {
      return { ok: false, code: "budget_exceeded", retryAfterSec: this.secondsToMidnight() };
    }
    this.userUsage.set(k, used + amount);
    this.globalUsage[kind] += amount;
    return { ok: true };
  }

  /** Give back a reservation (e.g. the upstream call failed before consuming credit). */
  refundBudget(userId: string, kind: UsageKind, amount: number): void {
    this.rollDay();
    const k = `${kind}:${userId}`;
    this.userUsage.set(k, Math.max(0, (this.userUsage.get(k) ?? 0) - amount));
    this.globalUsage[kind] = Math.max(0, this.globalUsage[kind] - amount);
  }

  /** Remaining for this user = min(user cap, global cap) minus usage. */
  budgetRemaining(userId: string): { sttSeconds: number; ttsChars: number } {
    this.rollDay();
    const rem = (kind: UsageKind) => {
      const c = this.caps(kind);
      return Math.max(0, Math.min(c.user - (this.userUsage.get(`${kind}:${userId}`) ?? 0), c.global - this.globalUsage[kind]));
    };
    return { sttSeconds: rem("stt"), ttsChars: rem("tts") };
  }
}

/**
 * Approximate audio length in seconds (for budgeting and the 30 s pre-check).
 * WAV: exact from the header byte rate; others: rough bitrate guess. Clamped >= 1.
 */
export function estimateAudioSeconds(bytes: Uint8Array, mimeOrExt: string): number {
  const t = mimeOrExt.toLowerCase();
  if (bytes.length >= 44 && t.includes("wav") && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") {
    const byteRate = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(28, true);
    if (byteRate > 0) return Math.max(1, (bytes.length - 44) / byteRate);
  }
  const rate = t.includes("flac") ? 60_000 : t.includes("ogg") ? 6_000 : t.includes("mp3") || t.includes("mpeg") ? 16_000 : 12_000;
  return Math.max(1, bytes.length / rate);
}

let shared: GnaniLimiter | undefined;

/** Process-wide limiter reading the env-tunable limits on every check. */
export function getLimiter(): GnaniLimiter {
  return (shared ??= new GnaniLimiter(() => getGnaniConfig().limits));
}

/** Test helper. */
export function resetLimiter(): void {
  shared = undefined;
}

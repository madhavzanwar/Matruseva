import "server-only";
import { createHash } from "node:crypto";

/**
 * Stable sha256 hex key for caching synthesised audio (same text+voice+model+
 * language+speed+container => same bytes). Contains no recoverable text.
 * Callers must normalise `speed` (number or preset string) before keying.
 */
export function ttsCacheKey(p: {
  text: string;
  voice: string;
  language: string;
  model: string;
  speed?: number | string;
  container: string;
}): string {
  const canonical = JSON.stringify([p.model, p.voice, p.language, p.speed ?? "default", p.container, p.text]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

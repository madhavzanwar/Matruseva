// Gnani language helpers. PLAIN module: no secrets, no node-only imports, safe
// to import from client components as well as server code.
//
// (The sha256 TTS cache key lives in ttsCacheKey.ts because it needs node:crypto.)

import type { Locale } from "@/lib/i18n/config";

/** Language codes accepted by Gnani STT (and by TTS, plus `auto` / `hi-en`). */
export const GNANI_LANGUAGE_CODES = [
  "bn-IN", "en-IN", "gu-IN", "hi-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "ta-IN", "te-IN",
] as const;
export type GnaniLanguageCode = (typeof GNANI_LANGUAGE_CODES)[number];

/** Extra values TTS accepts for `language`. */
export const GNANI_TTS_EXTRA_LANGUAGES = ["auto", "hi-en"] as const;
export type GnaniTtsLanguage = GnaniLanguageCode | (typeof GNANI_TTS_EXTRA_LANGUAGES)[number];

/** Languages MatruSetu counsels in (the staff UI itself only has en/hi/mr). */
export const APP_LANGUAGES = ["en", "hi", "mr", "gu"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const APP_LANGUAGE_TO_GNANI: Record<AppLanguage, GnaniLanguageCode> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
  gu: "gu-IN",
};

/** Staff UI locales (lib/i18n/config.ts) -> Gnani code. */
export const STAFF_LOCALE_TO_GNANI: Record<Locale, GnaniLanguageCode> = {
  en: "en-IN",
  hi: "hi-IN",
  mr: "mr-IN",
};

export function isGnaniLanguageCode(v: unknown): v is GnaniLanguageCode {
  return typeof v === "string" && (GNANI_LANGUAGE_CODES as readonly string[]).includes(v);
}

export function isGnaniTtsLanguage(v: unknown): v is GnaniTtsLanguage {
  return isGnaniLanguageCode(v) || (typeof v === "string" && (GNANI_TTS_EXTRA_LANGUAGES as readonly string[]).includes(v));
}

/** 'hi' -> 'hi-IN'. Returns null for languages Gnani is not used for here. */
export function toGnaniLanguage(appLanguage: string): GnaniLanguageCode | null {
  return (APP_LANGUAGE_TO_GNANI as Record<string, GnaniLanguageCode>)[appLanguage] ?? null;
}

/** 'hi-IN' -> 'hi' (null when the code is not one of the app's languages). */
export function fromGnaniLanguage(code: string): AppLanguage | null {
  for (const lang of APP_LANGUAGES) if (APP_LANGUAGE_TO_GNANI[lang] === code) return lang;
  return null;
}

export type VoiceGender = "female" | "male";
export const DEFAULT_VOICE_FEMALE = "Shivani";
export const DEFAULT_VOICE_MALE = "Avinash";

/** Default timbre-v3.0 voice (speaks all 10 languages). Config may override via env. */
export function defaultVoiceFor(gender: VoiceGender = "female"): string {
  return gender === "male" ? DEFAULT_VOICE_MALE : DEFAULT_VOICE_FEMALE;
}

// ---------------------------------------------------------------------------
// TTS text splitting
// ---------------------------------------------------------------------------

const SENTENCE_END_DANDA = new Set(["।", "॥"]);
const TERMINATORS = new Set([".", "?", "!"]);
const CLOSERS = new Set(['"', "'", ")", "]", "”", "’", "»"]);
const isWs = (c: string | undefined) => c === undefined || /\s/.test(c);

/** Split into sentences, keeping terminators. `.` only ends a sentence before whitespace/end ("2.5" and "Dr.Rao" stay whole). */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    const s = cur.replace(/\s+/g, " ").trim();
    if (s) out.push(s);
    cur = "";
  };
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\n" || ch === "\r") {
      flush();
      continue;
    }
    cur += ch;
    if (SENTENCE_END_DANDA.has(ch)) {
      while (i + 1 < chars.length && (SENTENCE_END_DANDA.has(chars[i + 1]) || CLOSERS.has(chars[i + 1]))) cur += chars[++i];
      flush();
    } else if (TERMINATORS.has(ch)) {
      let j = i;
      while (j + 1 < chars.length && (TERMINATORS.has(chars[j + 1]) || CLOSERS.has(chars[j + 1]))) j++;
      if (isWs(chars[j + 1])) {
        while (i < j) cur += chars[++i];
        flush();
      }
    }
  }
  flush();
  return out;
}

/** Greedy-pack pieces (joined by a space) into chunks of at most `max` chars. A single piece longer than `max` is emitted as-is. */
function pack(pieces: string[], max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const p of pieces) {
    if (!cur) cur = p;
    else if (cur.length + 1 + p.length <= max) cur += " " + p;
    else {
      out.push(cur);
      cur = p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Break an over-long sentence at commas/semicolons/colons, then at spaces. Never inside a word. */
function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const clauses = sentence.split(/(?<=[,;:،，；：])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const clause of pack(clauses, max)) {
    if (clause.length <= max) out.push(clause);
    else out.push(...pack(clause.split(/\s+/).filter(Boolean), max)); // a single word > max stays whole
  }
  return out;
}

/**
 * Split text into chunks for TTS, in order, each <= maxChars where possible
 * (only a single unbroken word longer than maxChars can exceed it).
 * Sentence boundaries: `।` `॥` `.` `?` `!` and newlines. Consecutive short
 * sentences are packed together to save requests. Works for Devanagari and Gujarati.
 */
export function splitForTts(text: string, maxChars = 350): string[] {
  const max = Math.max(20, Math.floor(maxChars));
  const units: string[] = [];
  for (const s of splitSentences(text ?? "")) units.push(...splitLong(s, max));
  return pack(units, max);
}

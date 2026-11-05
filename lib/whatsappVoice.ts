import "server-only";
import { handleIncomingWhatsAppMessage, detectLanguage } from "@/lib/whatsappBot";
import { isGnaniConfigured } from "@/lib/gnani/config";
import { transcribe as gnaniTranscribe, synthesize as gnaniSynthesize } from "@/lib/gnani/client";
import { isGnaniError, toClientError } from "@/lib/gnani/errors";
import { getLimiter, type GnaniLimiter } from "@/lib/gnani/limits";
import { splitForTts } from "@/lib/gnani/languages";
import {
  downloadWhatsAppMedia,
  uploadWhatsAppAudio,
  sendWhatsAppAudio,
  sendWhatsAppText,
  canSendWhatsApp,
  WhatsAppMediaError,
} from "@/lib/whatsappMedia";
import type { SupportedLanguage } from "@/lib/whatsapp";

/**
 * Voice-note handling for the WhatsApp webhook (called only AFTER the HMAC check).
 * Never logs audio, transcripts or tokens; never exposes upstream errors to the mother.
 */

// Mother-facing failure messages (hi + mr + gu + en in one short message, sent as text).
export const MSG_UNAVAILABLE =
  "🙏 आवाज़ संदेश अभी समझ नहीं पा रहे। कृपया 1, 2 या 3 टाइप करके लिखें।\n" +
  "व्हॉइस मेसेज सध्या समजत नाही. कृपया 1, 2 किंवा 3 टाइप करा.\n" +
  "વૉઇસ મેસેજ હમણાં સમજાતો નથી. કૃપા કરી 1, 2 અથવા 3 ટાઇપ કરો.\n" +
  "We cannot understand voice notes right now. Please type 1, 2 or 3.";
export const MSG_TOO_LONG =
  "🙏 कृपया 30 सेकंड से छोटा आवाज़ संदेश भेजें।\n" +
  "कृपया 30 सेकंदांपेक्षा लहान व्हॉइस मेसेज पाठवा.\n" +
  "કૃપા કરી 30 સેકન્ડથી નાનો વૉઇસ મેસેજ મોકલો.\n" +
  "Please send a voice note shorter than 30 seconds.";
export const MSG_UNCLEAR =
  "🙏 आवाज़ साफ़ सुनाई नहीं दी। कृपया फिर से बोलें या 1, 2, 3 टाइप करें।\n" +
  "आवाज स्पष्ट ऐकू आला नाही. कृपया पुन्हा बोला किंवा 1, 2, 3 टाइप करा.\n" +
  "અવાજ સ્પષ્ટ સંભળાયો નહીં. કૃપા કરી ફરી બોલો અથવા 1, 2, 3 ટાઇપ કરો.\n" +
  "We could not hear that clearly. Please speak again or type 1, 2, 3.";

export interface WhatsAppAudioMessage {
  from?: unknown;
  audio?: { id?: unknown; mime_type?: unknown; voice?: unknown } | null;
}

export interface VoiceDeps {
  fetch?: typeof fetch;
  limiter?: GnaniLimiter;
  transcribe?: typeof gnaniTranscribe;
  synthesize?: typeof gnaniSynthesize;
  handle?: typeof handleIncomingWhatsAppMessage;
}

export type VoiceResult =
  | "replied"
  | "ignored"
  | "unavailable"
  | "too_long"
  | "unclear"
  | "rate_limited";

/** Default STT language: indic-auto, or GNANI_WA_LANGS (comma list, max 4 valid codes). */
export function whatsappSttLanguages(env: string | undefined = process.env.GNANI_WA_LANGS): string {
  const list = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  return list.length ? list.join(",") : "indic-auto";
}

/** Removes markdown bold/italics, emoji, bullets and URLs so TTS reads clean prose. */
export function cleanTextForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[*_~`]/g, "")
    .replace(/[\p{Extended_Pictographic}‍️⃣•▪◦]/gu, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function ttsLanguageFor(text: string): "gu-IN" | "mr-IN" | "hi-IN" | "en-IN" {
  if (/[઀-૿]/.test(text)) return "gu-IN";
  if (/[ऀ-ॿ]/.test(text)) return detectLanguage(text, "hi") === "mr" ? "mr-IN" : "hi-IN";
  return /[A-Za-z]{3}/.test(text) ? "en-IN" : "hi-IN";
}

/** Use the STT-detected language only to separate hi/mr when the transcript is Devanagari. */
function preferredLangFrom(transcript: string, detected?: string): SupportedLanguage | undefined {
  if (!/[ऀ-ॿ]/.test(transcript)) return undefined;
  if (detected === "mr-IN") return "mr";
  if (detected === "hi-IN") return "hi";
  return undefined;
}

const SECONDS_PER_BYTE = 1 / 2500; // WhatsApp Opus voice notes are ~20 kbps; deliberately conservative
const MAX_VOICE_SECONDS = 30;

function estimateSeconds(bytes: number): number {
  return Math.min(MAX_VOICE_SECONDS, Math.max(3, Math.ceil(bytes * SECONDS_PER_BYTE)));
}

export async function handleWhatsAppAudioMessage(msg: WhatsAppAudioMessage, deps: VoiceDeps = {}): Promise<VoiceResult> {
  const phone = typeof msg.from === "string" ? msg.from.replace(/\D/g, "") : "";
  const mediaId = typeof msg.audio?.id === "string" ? msg.audio.id : "";
  if (!phone || !mediaId) return "ignored";

  const doFetch = deps.fetch;
  const canReply = canSendWhatsApp();
  const say = async (text: string) => {
    if (!canReply) return;
    try {
      await sendWhatsAppText(phone, text, { fetch: doFetch });
    } catch (e) {
      console.error("WhatsApp reply failed:", e instanceof WhatsAppMediaError ? e.code : "error");
    }
  };

  if (!isGnaniConfigured()) {
    await say(MSG_UNAVAILABLE);
    return "unavailable";
  }

  const limiter = deps.limiter ?? getLimiter();
  const userKey = `wa:${phone}`;
  if (!limiter.checkRate(userKey, "stt").ok) {
    await say(MSG_UNAVAILABLE);
    return "rate_limited";
  }

  let media;
  try {
    media = await downloadWhatsAppMedia(mediaId, { fetch: doFetch });
  } catch (e) {
    const code = e instanceof WhatsAppMediaError ? e.code : "error";
    console.error("WhatsApp media download failed:", code);
    await say(code === "too_large" ? MSG_TOO_LONG : MSG_UNAVAILABLE);
    return code === "too_large" ? "too_long" : "unavailable";
  }

  const seconds = estimateSeconds(media.reportedSize ?? media.buffer.length);
  if (!limiter.consumeBudget(userKey, "stt", seconds).ok) {
    await say(MSG_UNAVAILABLE);
    return "rate_limited";
  }

  let transcript = "";
  let detected: string | undefined;
  try {
    const r = await (deps.transcribe ?? gnaniTranscribe)({
      audio: media.buffer,
      filename: "voice.ogg",
      mime: "audio/ogg",
      languageCode: whatsappSttLanguages(),
      format: "transcribe",
    });
    transcript = r.transcript.trim();
    detected = r.detectedLanguage;
  } catch (e) {
    limiter.refundBudget(userKey, "stt", seconds);
    const code = isGnaniError(e) ? toClientError(e).code : "error";
    console.error("WhatsApp voice transcription failed:", code);
    if (code === "audio_too_long") {
      await say(MSG_TOO_LONG);
      return "too_long";
    }
    if (code === "audio_empty" || code === "audio_unsupported") {
      await say(MSG_UNCLEAR);
      return "unclear";
    }
    await say(MSG_UNAVAILABLE);
    return "unavailable";
  }

  if (!/[\p{L}\p{N}]/u.test(transcript)) {
    await say(MSG_UNCLEAR);
    return "unclear";
  }

  const result = await (deps.handle ?? handleIncomingWhatsAppMessage)({
    phone,
    messageText: transcript,
    preferredLang: preferredLangFrom(transcript, detected),
    via: "voice",
  });

  await say(result.replyText);
  if (result.success) await maybeSendVoiceReply(phone, result.replyText, limiter, userKey, deps);
  return "replied";
}

/** Optional spoken copy of the reply. Any failure is swallowed: the text reply already went out. */
async function maybeSendVoiceReply(phone: string, replyText: string, limiter: GnaniLimiter, userKey: string, deps: VoiceDeps): Promise<void> {
  if (process.env.WHATSAPP_VOICE_REPLIES !== "1" || !canSendWhatsApp() || !isGnaniConfigured()) return;
  let reserved = 0;
  try {
    const clean = cleanTextForSpeech(replyText);
    if (!clean) return;
    const maxChars = 600;
    let spoken = "";
    for (const part of splitForTts(clean, 350)) {
      if ((spoken + " " + part).trim().length > maxChars) break;
      spoken = (spoken + " " + part).trim();
    }
    if (!spoken) spoken = clean.slice(0, maxChars);
    if (!limiter.checkRate(userKey, "tts").ok) return;
    if (!limiter.consumeBudget(userKey, "tts", spoken.length).ok) return;
    reserved = spoken.length;
    const { audio } = await (deps.synthesize ?? gnaniSynthesize)({
      text: spoken,
      language: ttsLanguageFor(clean),
      container: "ogg",
    });
    reserved = 0; // synthesis succeeded: the credit is spent even if delivery fails below
    const id = await uploadWhatsAppAudio(audio, "audio/ogg", { fetch: deps.fetch });
    await sendWhatsAppAudio(phone, id, { fetch: deps.fetch });
  } catch (e) {
    if (reserved) limiter.refundBudget(userKey, "tts", reserved);
    console.error("WhatsApp voice reply failed:", isGnaniError(e) ? toClientError(e).code : e instanceof WhatsAppMediaError ? e.code : "error");
  }
}

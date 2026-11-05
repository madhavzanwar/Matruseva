# Gnani AI integration — architecture

MatruSetu uses Gnani AI's speech models for the places where the product is voice-first:
**Prisma** (speech-to-text) for dictation and WhatsApp voice notes, **Timbre** (text-to-speech)
for the audio counselling that mothers listen to, and optionally **Evon** (reasoning model) for
turning free-form dictation into structured vitals.

Everything is **server-mediated** and **optional**: with no key, or when Gnani is unavailable, the app
falls back to the browser's Web Speech API / `speechSynthesis` exactly as before.

> Status: design + implementation notes. Facts about the Gnani API come from the official docs
> (<https://docs.gnani.ai>). The unauthenticated error shapes were verified live; transcription and
> synthesis quality could **not** be verified without a key — run `npm run gnani:check` with yours.

## 1. What Gnani gives us (and the limits that shaped the design)

| Capability | API | Facts that matter |
|---|---|---|
| Speech-to-text | `POST /stt/v3` (multipart), model `prisma-v3.0` | 10 Indian languages + `indic-auto` + Hinglish code-mix; **max 30 s** per request; accepts WAV/MP3/OGG/FLAC/AAC/M4A (**not WebM**); `format=transcribe` turns spoken numbers into digits; `keyterms` (≤200) biases recognition; `topic`/`previous_text` give context |
| Text-to-speech | `POST /api/v1/tts/inference`, model `timbre-v3.0` | 13 voices, **every voice speaks all 10 languages** (incl. Marathi, Gujarati); `container=mp3` is browser-playable; speed 0.85–1.15; no documented length limit but overlong text returns 500 |
| Reasoning | Evon v3.3 (30B MoE, Apache-2.0, 128K ctx) | Open weights; **no hosted API documented** — needs an H100-class GPU (vLLM/SGLang, OpenAI-compatible) |
| Auth | `X-API-Key-ID` header | 3 free keys; some accounts allow **one active request at a time**; 429 has no `Retry-After`; 402 = out of credit |
| Budget | 5,000 programme credits | Must be cached and rate-limited |

## 2. Architecture

```
                         ┌──────────────────────── Next.js server (route handlers) ───────────────────────┐
                         │  auth (staff session or signed mother link)  →  rate limit + daily budget       │
  Staff browser          │            │                                                                    │         api.vachana.ai
  ──────────────         │            ▼                                                                    │      ┌──────────────────┐
  VoiceScribe            │   ┌───────────────┐   key pool (1 in-flight / key, FIFO queue, backoff,         │      │ Prisma  /stt/v3  │
  MediaRecorder          │   │ lib/gnani     │   circuit breaker, 402 fail-fast)                           │ ───► │ Timbre  /tts/... │
  → 16 kHz WAV ──────────┼──►│ client + pool │────────────────────────────────────────────────────────────┼──────┤                  │
  POST /api/gnani/stt    │   └───────────────┘                                                              │      └──────────────────┘
                         │            ▲                                                                    │
  Counselling audio      │            │ text built SERVER-side from patient data (never client-supplied)   │
  (staff modal + mother  │   TTS: chunk ≤350 chars → cache (private Storage, sha256) → timbre-v3.0 mp3      │
  link) plays mp3 parts ◄┼───  GET /api/gnani/tts/counsel   |  GET /listen/[token]/audio?part=n            │
                         │                                                                                  │
  WhatsApp (mother)      │   Meta webhook (HMAC-verified) → audio message → Graph media download →         │
  voice note ────────────┼──► Prisma (OGG/Opus accepted) → intent → reply (text, optional Timbre OGG voice) │
                         │                                                                                  │
  Optional: Evon         │   transcript → OpenAI-compatible Evon endpoint → JSON vitals (validated, shown   │
  (self-hosted GPU)      │   for human review, never auto-saved)                                            │
                         └──────────────────────────────────────────────────────────────────────────────────┘

  Fallback ladder (every feature):  Gnani → (no key | 401/402/403 | 429 exhausted | 5xx | timeout | offline) → browser Web Speech / speechSynthesis
```

### Why server-mediated
* The key must never reach the browser; browsers also cannot set the `X-API-Key-ID` header on a WebSocket,
  so Gnani's realtime sockets are not usable from the client anyway.
* One place to enforce **auth, rate limits, the credit budget, caching and PII rules**.

## 3. Feature flows

### 3.1 Voice dictation → vitals (staff)
1. Browser records with `MediaRecorder` and converts to **16 kHz mono WAV** (Chrome emits WebM/Opus, which Prisma rejects).
2. Recordings auto-stop at ~28 s (the REST cap); longer dictations are sent as consecutive segments with `previous_text`.
3. `POST /api/gnani/stt` → Prisma v3.0 with `format=transcribe` (digits) and clinical `keyterms`
   (BP, Hb, haemoglobin, FHR, फंडल हाइट, …) and `language_code` from the staff locale (`hi-IN,en-IN` code-mix hint).
4. The transcript goes through `lib/voiceScribe.ts`, **extended to understand Devanagari** (Hindi/Marathi keywords and
   numerals) because Prisma returns native script — the old parser only understood romanised text.
5. Optional second pass with Evon fills fields the rules missed; results are range-validated and shown for review.
6. If Gnani is unavailable the modal silently uses the browser recogniser (current behaviour).

### 3.2 Counselling audio (mothers + staff preview)
1. The counselling script (`lib/voiceCounselor.ts`) is generated **on the server** from patient data, so a caller can never
   make us synthesise arbitrary text with our credits.
2. Split into ≤350-char sentence-aware parts (avoids the HTTP 500 on long text), each synthesised with `timbre-v3.0`, mp3.
3. Audio parts are cached in a **private** Storage bucket keyed by `sha256(text|voice|language|model|speed|container)`;
   the same advice for the same patient state costs credits once.
4. The player plays parts back-to-back with a normal `<audio>` element (works on every phone, supports pause/seek —
   unlike `speechSynthesis`, which lacks Marathi/Gujarati voices on many devices).
5. Mothers reach it through the existing signed `/listen/[token]` link (`/listen/[token]/audio?part=n`); staff through an
   authenticated route scoped by RLS to their clinic.

### 3.3 WhatsApp voice notes (mothers)
Many mothers will answer with a voice note rather than typing. The webhook (already HMAC-verified) now handles
`type: "audio"`: download via the Graph API, transcribe with Prisma (OGG/Opus is accepted directly, `indic-auto`/the
patient's language as hint), run the same intent detection as text (confirm / reschedule / info), and reply. Notes longer than
30 s get a friendly "please send a shorter message". Optional spoken replies use Timbre `container=ogg`.

### 3.4 Evon (optional)
Evon has open weights and no hosted API, so it is wired as an **OpenAI-compatible endpoint you host** (`EVON_BASE_URL`).
It is used only to *extract structured vitals from dictation* behind range validation and human review. It is deliberately
**not** used to write counselling advice: clinical wording stays deterministic and clinician-reviewed.

## 4. Pipeline validation — what would have broken

| # | Problem | Fix |
|---|---|---|
| 1 | Chrome `MediaRecorder` → WebM/Opus is not an accepted STT format | Client-side WAV encoder (16 kHz mono) |
| 2 | 30 s STT cap | Auto-stop + segmenting |
| 3 | Prisma returns **Devanagari**; `voiceScribe.ts` parses romanised text | Parser extended for Devanagari keywords/numerals + `format=transcribe` digits |
| 4 | Key exposure / WebSocket header limitation | Server proxy, keys server-only |
| 5 | One active request per key; 429 without `Retry-After` | Key pool, per-key concurrency 1, FIFO queue, backoff, use all 3 free keys |
| 6 | 5,000 credits | Cache, per-user rate limits, daily budget, server-built TTS text only |
| 7 | TTS 500 on long text | Sentence-aware chunking |
| 8 | Voice/model mismatch → 400 | Voice picked per model |
| 9 | Offline / no key / out of credit | Fallback ladder to browser APIs; PWA service worker never caches `/api/gnani/*` |
| 10 | Serverless limits (4.5 MB body, function time) | 30 s WAV @16 kHz mono ≈ 1 MB; `maxDuration` set; STT p50 is seconds |

## 5. Privacy and safety
* Audio and text sent to Gnani are **health data**. Nothing is logged except request id, status and latency.
* TTS text contains the mother's first name and vitals. State this in the clinic's consent notice; the cache bucket is private.
* Dictation results are never saved automatically — the clinician reviews every field.
* Evon output is range-validated and never used for patient-facing advice.
* DPDP Act: obtain consent before sending a mother's voice to a third party; Gnani's retention terms apply.

## 6. Configuration
See `.env.example` (`GNANI_API_KEYS`, `GNANI_BASE_URL`, `GNANI_STT_MODEL`, `GNANI_TTS_MODEL`, voice defaults,
`GNANI_ENABLED`, limits, `EVON_BASE_URL`). Keys are server-only; pool the 3 free keys comma-separated.

## 7. Verifying with a real key
```bash
npm run gnani:check     # TTS → STT round trip in Hindi, Marathi and Gujarati, with latencies and a similarity score
```

# MatruSetu

Assistive pregnancy tracking and OPD digitisation for OB-GYN private practices in India — built for Health-a-thon 2026 (Koita Foundation / IIT Bombay), Maternal & Child Health track, "Patient Follow-up & Continuity of Care."

For a doctor and care team managing dozens to hundreds of active pregnancies, MatruSetu tracks each patient's week-by-week ANC schedule (scans, tests, injections), flags patients who are drifting out of follow-up, and turns photographed OPD case papers, WhatsApp reports and PDFs into one searchable patient timeline.

## Stack

- Next.js (App Router) + TypeScript, Tailwind v4
- Supabase (Postgres, Auth, Storage, RLS)
- Tesseract.js (in-browser OCR) + pdfjs-dist
- Vitest (unit) + Playwright (e2e)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL + keys
npm run dev
```

### Database

Migrations live in `supabase/migrations/`. Against a linked Supabase project:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Demo data

`npm run db:seed` creates a demo clinic (`demo.doctor@matrusetu.test` / `DemoClinic123!`) with ~40 synthetic patients spread across trimesters and follow-up states (on track / at risk / lost). Safe to run against a shared project — it no-ops if that clinic already has patients rather than duplicating them. All data is fabricated.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (`next build --webpack`; Serwist's service worker needs webpack, not Turbopack) |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `next typegen` then `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Unit tests (Vitest; 14 files, 95 tests) |
| `npm run db:validate` | Offline SQL syntax check for migrations |
| `npm run gnani:check` | Real-key smoke test: Timbre → Prisma round trip in Hindi, Marathi and Gujarati |
| `npm run db:seed` | Seed a demo clinic with synthetic patients (needs `SUPABASE_SERVICE_ROLE_KEY`) |
| `npm run test:e2e` | Playwright golden-path test (needs a running dev server + live Supabase credentials — not run in CI, see `playwright.config.ts`) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, `db:validate`, `npm audit --omit=dev --audit-level=high` (fails on high/critical advisories) and a production build.

## Environment variables

Copy `.env.example` to `.env.local`. Nothing below has an insecure default: if a required value is missing the related feature fails closed.

| Variable | Required | Scope | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public | Supabase project URL. If this or the anon key is missing, the app returns 503 (except `/`, `/offline`, `/listen/*`, `/api/whatsapp`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public | Supabase anon key (all access is gated by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server-only** | Bypasses RLS. Used only by the WhatsApp bot/webhook, the public listen page and staff invites. Never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | Yes | Public | Deployed origin; used for auth redirects and the links sent to mothers |
| `LISTEN_LINK_SECRET` | Yes (production) | **Server-only** | HMAC key for the signed `/listen/<token>` links. No default; link creation and verification fail closed without it. Generate with `openssl rand -base64 32`. Rotating it invalidates every link already sent |
| `WHATSAPP_VERIFY_TOKEN` | For the webhook | **Server-only** | Any long random string; must match what you enter in Meta's webhook setup. No default |
| `WHATSAPP_APP_SECRET` | For the webhook | **Server-only** | Meta app secret; used to verify `X-Hub-Signature-256` on every POST. No default; POST returns 503 without it |
| `GNANI_API_KEYS` | Optional | **Server-only** | Gnani AI keys (comma-separated pool; the 3 free keys can all be listed). Enables Prisma speech-to-text dictation, Timbre counselling audio and WhatsApp voice notes. Without it the app uses the browser's speech APIs. See `docs/GNANI_INTEGRATION.md` |
| `GNANI_ENABLED`, `GNANI_BASE_URL`, `GNANI_STT_MODEL`, `GNANI_TTS_MODEL`, `GNANI_TTS_VOICE_FEMALE/MALE`, `GNANI_*_PER_MINUTE`, `GNANI_*_DAILY_*` | Optional | **Server-only** | Kill switch, endpoint/model/voice overrides and per-user/global rate and credit budgets (defaults in `.env.example`) |
| `WHATSAPP_VOICE_REPLIES`, `GNANI_WA_LANGS` | Optional | **Server-only** | Send a spoken (Timbre) copy of bot replies; STT language hints for incoming voice notes |
| `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Optional | **Server-only** | If both are set, bot replies are sent back through the Graph API; otherwise the webhook only records the outcome |
| `DEMO_MODE` | Optional | **Server-only** | `1` enables demo mode (below). Leave unset in production |

### Demo mode

Demo mode is an explicit server-side opt-in and is **off by default**. With `DEMO_MODE=1` the shared demo login (`demo.doctor@matrusetu.test` / `DemoClinic123!`) works and the app serves a fabricated 10-patient dataset (`lib/demo-data.ts`) instead of Supabase; this also lets it run with no Supabase config at all (offline demo). Edits made in demo mode are kept in a local, gitignored `.matrusetu-demo-store.json`. Without `DEMO_MODE=1` the `matrusetu_demo` cookie is ignored, and missing Supabase config makes the app answer 503 instead of opening up. Use it only on a throwaway deployment.

## Deployment

**Apply database migrations before deploying new code.** In particular `20261104000000_latest_visits_view.sql` creates the `latest_visits` view and `20261105000000_client_request_id.sql` adds the idempotency column the offline queue relies on, and `20261107000000_tts_audio_cache.sql` creates the private `tts-audio` bucket for cached counselling audio. The view is what the dashboard snapshot reads; if the code ships first, the snapshot silently shows no latest visits (no error). Run `npx supabase db push` first, then deploy.

The app deploys to [Vercel](https://vercel.com) with no extra config — it auto-detects Next.js and runs `npm run build` (which already targets webpack, required by Serwist's PWA build; see `next.config.ts`).

1. Import the GitHub repo at vercel.com/new.
2. Set these environment variables in the Vercel project (Settings → Environment Variables), same values as `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — never prefix with `NEXT_PUBLIC_`)
   - `NEXT_PUBLIC_SITE_URL` — set to the deployed URL (e.g. `https://your-app.vercel.app`)
   - `LISTEN_LINK_SECRET` — `openssl rand -base64 32`
   - `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` if you enable the webhook (optionally `WHATSAPP_API_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`)
   - Do **not** set `DEMO_MODE` in production.
3. In the Supabase dashboard, under Authentication → URL Configuration, add the deployed URL to both **Site URL** and **Redirect URLs** — otherwise auth callbacks (email confirmation, Google OAuth, staff invite links) resolve to `localhost`.
4. If using Google sign-in, the Google Cloud OAuth client's authorized redirect URI must be your Supabase project's callback (`https://<project-ref>.supabase.co/auth/v1/callback`), not the app's own domain — this doesn't change when you deploy.

5. WhatsApp webhook (optional): in the Meta developer console open WhatsApp → Configuration, set the callback URL to `https://<your-domain>/api/whatsapp/webhook`, enter the same value as `WHATSAPP_VERIFY_TOKEN` as the verify token, and subscribe to the `messages` field. Copy the app secret (App Settings → Basic) into `WHATSAPP_APP_SECRET`. Redeploy after changing env vars, then click "Verify and save" in Meta.

## Features

Auth/onboarding (email/password + Google OAuth), patient registration with auto-generated ANC schedules, patient edit with LMP correction and schedule regeneration, visit recording, delivery outcome and pregnancy closure, a "Today" command centre and patient registry with risk/clinical-alert filters, the follow-up call queue (WhatsApp/tel links, per-clinic templates, contact logging, batch logging), document capture with in-browser OCR and full-text search, the OPD register, doctor Settings (clinic details, thresholds, schedule template, staff invites, message templates), clinic analytics summary, and PWA install with an offline fallback page.

Also in the app:

- **Hindi and Marathi staff UI**: the whole app (landing, auth, dashboard, patients, visits, call queue, documents, OPD, settings, reports) is available in English, हिन्दी and मराठी. Switch with the language control in the sidebar (stored in the `ms_locale` cookie). Catalogues live in `lib/i18n/messages/` with compile-time and test-time key parity; see `docs/I18N.md` and `lib/i18n/GLOSSARY.md`. **The Hindi/Marathi wording has not been clinician- or native-speaker-reviewed** and must be before clinical use.
- **Gnani AI voice (optional)**: staff dictation uses Prisma STT (browser → 16 kHz WAV → server → Gnani, with a Devanagari-aware vitals parser), counselling audio for mothers and staff is synthesised by Timbre (cached, served as mp3 parts), and the WhatsApp bot understands voice notes (with a broad danger-sign screen). Every feature falls back to the browser's speech APIs when Gnani is not configured or unavailable. Verify a real key with `npm run gnani:check`. Architecture and limits: `docs/GNANI_INTEGRATION.md`.
- **Offline write queue**: recording a visit or logging a contact while offline (or when the request can't reach the server) saves it in the browser's IndexedDB and replays it when the connection returns, with a status pill, retry/discard for failures, and an idempotency key (`client_request_id`) so replays never duplicate (`lib/offlineQueue.ts`, `components/OfflineSync.tsx`). See `docs/SECURITY.md` for what is stored.
- **WhatsApp bot**: reminders and replies (confirm / reschedule / info; English, Hindi, Marathi) via the signed `/api/whatsapp/webhook`, plus an in-app simulator on the call queue that uses the authenticated `processBotReply` server action, not the webhook (`lib/whatsappBot.ts`).
- **Voice counselling**: generates a counselling script in Hindi, Marathi, Gujarati or English from the patient's data (`lib/voiceCounselor.ts`); the doctor can create a signed public listen link for the mother.
- **Voice-to-vitals**: parses dictated English/Hindi/Marathi/Hinglish vitals into the visit form (`lib/voiceScribe.ts`).
- **QR Health Pass and reception scanner**: printable mother-and-child card and a `/scan` page (camera, image upload or manual ID).
- **Clinical flags** (`lib/clinical.ts`) and FOGSI/MoHFW-based ANC protocol definitions (`lib/clinicalProtocols.ts`), shown as assistive prompts, not diagnoses; nutrition/diet guidance and a one-page patient report.
- **Offline demo mode** (see above).

Quality: Vitest unit tests (95), one Playwright golden-path spec against live Supabase, WCAG AA colour contrast and 44px touch targets, `npm audit --omit=dev` clean at the time of writing.

Not yet done: Hindi/Marathi wording for the per-clinic message templates (the field holds one language per template; wording needs the Clinical Lead's review), proactive outbound reminders (the "bot reminder" action only composes the message and logs it; staff send via the one-tap WhatsApp link, and the webhook only replies to inbound messages — a production WhatsApp Business setup needs Meta Business verification, an external approval), and Clinical Lead sign-off on the default ANC schedule windows and follow-up-risk thresholds.

## Security model

- **Row-level security** on every table, scoped to the user's clinic (`private.current_clinic_id()`); doctor-only operations also check `private.is_doctor()`. Views use `security_invoker`, and storage is scoped by clinic folder.
- **Service-role client** (`lib/supabase/admin.ts`, server-only) is used in exactly three places: the WhatsApp bot/webhook, the public `/listen/<token>` page, and the staff-invite server action. The invite action checks the caller is a doctor first.
- **Webhook**: GET requires `WHATSAPP_VERIFY_TOKEN`; POST requires a valid `X-Hub-Signature-256` HMAC (`WHATSAPP_APP_SECRET`), compared in constant time.
- **Signed listen links**: `base64url(payload).HMAC-SHA256`, payload = patient id, language, expiry; valid 14 days. They are bearer links (anyone with the URL can open that one counselling page), served with `no-referrer`, `noindex` and `no-store` headers.
- **Fail closed**: missing Supabase config returns 503; missing webhook or listen secrets reject requests; demo bypass requires `DEMO_MODE=1`.
- Details and caveats: `docs/SECURITY.md`.

## Project structure

| Path | Contents |
|---|---|
| `app/(app)/` | Authenticated staff app: `today`, `patients`, `calls`, `documents`, `opd`, `scan`, `settings` |
| `app/(auth)/` | Login, signup, onboarding and their server actions |
| `app/listen/[token]/` | Public, signed-link counselling page for mothers |
| `app/api/whatsapp/webhook/` | Meta WhatsApp Cloud API webhook |
| `app/offline/`, `app/sw.ts` | PWA offline fallback and Serwist service worker |
| `components/` | UI; heavy modals (voice, QR, edit, nutrition, charts) are lazy-loaded with `next/dynamic`; `AppNav` provides a permanent desktop sidebar that collapses to icons (Ctrl/Cmd+B, remembered in the `ms_sidebar` cookie) with an overdue badge on Call queue |
| `lib/` | Domain logic: pregnancy dating, ANC schedule, risk, clinical flags/protocols, WhatsApp bot, voice counsellor/scribe, listen links, `snapshot.ts` (clinic worklist), `paging.ts` (50-row "Show more" for long lists) |
| `lib/supabase/` | Browser/server/admin clients, session middleware, generated types |
| `proxy.ts` | Next.js request proxy; runs session refresh and auth redirects |
| `supabase/migrations/` | Schema, RLS, storage, pregnancy closure, `latest_visits` view |
| `scripts/` | `seed.mjs`, `validate-sql.mjs` |
| `e2e/`, `lib/*.test.ts` | Playwright and Vitest tests |

`next.config.ts` sets a 30s client router cache for dynamic pages (mutations purge it) and long-lived cache headers for static assets.

See `docs/SECURITY.md` for the security notes and `docs/ANALYSIS_REPORT.md` for a dated (partly superseded) project review.

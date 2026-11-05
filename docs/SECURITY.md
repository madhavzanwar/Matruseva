# MatruSetu — Security notes

Current as of 4 Nov 2026. Verified against the code, not older docs.

## Authentication and fail-closed config
- `proxy.ts` -> `lib/supabase/middleware.ts` refreshes the Supabase session on each request (`getClaims()`, local JWT verification) and redirects signed-out users to `/login`.
- Public paths: `/`, `/login`, `/signup`, `/auth`, `/offline`, `/api/whatsapp`, `/listen/*`.
- If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are missing, every path except `/`, `/offline`, `/api/whatsapp` and `/listen/*` returns 503. It never serves the app unauthenticated.

## Demo mode
- Opt-in only via server env `DEMO_MODE=1` (`lib/demo.ts`). The `matrusetu_demo` cookie is honoured only when `DEMO_MODE=1`; otherwise it is ignored.
- Earlier versions treated the cookie (or missing Supabase config) as a login bypass. That is no longer the case. Never set `DEMO_MODE` in production.
- With `DEMO_MODE=1` and no `LISTEN_LINK_SECRET`, listen links use a fixed demo-only secret.

## Data access
- RLS is enabled on all tables and scoped to the caller's clinic; doctor-only actions also check `private.is_doctor()`. Views use `security_invoker = true`, including `latest_visits`.
- The service-role client (`lib/supabase/admin.ts`, `server-only`) is used in: the WhatsApp bot/webhook (`lib/whatsappBot.ts`), the public listen page (`app/listen/[token]/page.tsx`), and staff invites (`app/(app)/settings/actions.ts`, which verifies the caller is a doctor first). It bypasses RLS, so these paths do their own scoping.

## WhatsApp webhook (`/api/whatsapp/webhook`)
- GET handshake needs `WHATSAPP_VERIFY_TOKEN` (constant-time compare, no default).
- POST needs `WHATSAPP_APP_SECRET` (503 if unset) and a valid `X-Hub-Signature-256` HMAC-SHA256 of the raw body (401 otherwise).
- The in-app simulator uses the authenticated `processBotReply` server action, not this route.

## Signed listen links
- `lib/listenLink.ts`: `base64url({p, l, e}) . base64url(HMAC-SHA256(LISTEN_LINK_SECRET))`, default TTL 14 days. Signed, not encrypted; contains patient id, language, expiry.
- It is a bearer capability: anyone with the URL can view that patient's counselling page until expiry. Share it only with the mother.
- `/listen/*` is served with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store` (`next.config.ts`).
- No secret -> link creation throws and verification returns null. Rotating the secret revokes all issued links; there is no per-link revocation.

## Offline queue
- Scope: only two writes can be queued while offline or unreachable: recording a visit and logging a contact (`lib/offlineQueue.ts`, replayed by `components/OfflineSync.tsx`). Nothing else is queued.
- What is stored: IndexedDB database `matrusetu-offline` in the browser holds, per entry, an id, type, patient id, timestamps/attempt count/last error and a whitelisted set of form fields (visit vitals/notes/dates; contact channel/outcome/reason/notes). This is patient health data at rest on the device, unencrypted, readable by anything running in the app's origin and by anyone with access to the unlocked browser profile. Use clinic devices with a screen lock.
- Queued entries are only sent through the normal server actions, so auth, zod validation and RLS apply at replay time exactly as for a live request; the queue grants no new access. `created_by` is whoever is signed in when the entry syncs.
- Lifetime: an entry is removed once the server accepts it; permanent errors are kept as "failed" until the user retries or discards them. Sign-out (`AppNav`) asks for confirmation if unsynced entries exist and then wipes the queue. If the session simply expires, entries stay until the next sign-in syncs or discards them.
- Idempotency: each entry's UUID is sent as `client_request_id` (unique partial index on `visits` and `contact_log`); a unique violation on it is treated as already applied. The key is not a secret and does not authorise anything.
- Related: the service worker's runtime cache (`defaultCache`) may keep copies of visited authenticated pages in Cache Storage on the device; sign-out does not purge it.

## Gnani AI (speech) integration
- Keys (`GNANI_API_KEYS`) are server-only; all calls go through route handlers. `/api/gnani/*` requires a staff session; the mother's audio is served only through the signed `/listen/[token]/audio` route (invalid/expired token → empty 404).
- Counselling text is always built **server-side** from patient data, so nobody can make the server synthesise arbitrary text with our credits. Cache hits cost nothing; misses are rate-limited per user and charged against a daily budget (per-instance memory — see GNANI_INTEGRATION.md).
- Audio and counselling text are health data sent to a third party (Gnani). Nothing but request id, status and latency is logged. Obtain consent from mothers before sending their voice to Gnani; DPDP Act obligations apply.
- Synthesised audio is cached in a **private** Storage bucket (`tts-audio`, service role only) keyed by a hash of the text; the service worker never caches `/api/gnani/*` or `/listen/*`.
- WhatsApp voice notes: the webhook HMAC check runs before any media download or Gnani call; per-sender rate limits apply; transcripts are used only for intent detection and the contact-log note. A broad danger-sign screen replies urgently and flags the log for staff follow-up (false positives are intentional; the keyword list needs clinical review).

## Dependencies and CI
- CI runs `npm audit --omit=dev --audit-level=high` and fails on high/critical advisories. At the time of writing `npm audit --omit=dev` reports 0 vulnerabilities.

## Known limits
- OCR runs in the browser; uploaded documents are stored in the clinic-scoped Supabase Storage bucket.
- Clinical flags and schedules are assistive and await Clinical Lead sign-off.

# Gnani setup — copy-paste guide

The Gnani integration is **already in the code** (dictation, counselling audio, WhatsApp voice notes —
see `GNANI_INTEGRATION.md`). Switching it on takes three things: **keys**, **one SQL paste**, **a redeploy**.
Without keys the app still works; it just uses the browser's built-in voice.

Do the steps in this order. Total time: about 10 minutes.

---

## Step 1 — Get the Gnani API keys

1. Open <https://app.gnani.ai/voice> and sign in.
   * Use the **same email you registered for the challenge with.** If you registered as a team of two, the
     5,000 credits are on the **primary registrant's** account, so that person must sign in.
2. Find the **API keys** area and create keys. You can make **3 free keys**.
3. Copy each key and keep them somewhere private (a notes app is fine). Some dashboards show a key only once.
4. Join the keys with commas, no spaces: `key1,key2,key3`. This one line is your `GNANI_API_KEYS`.

> Never paste keys into GitHub, WhatsApp groups, screenshots or the chat with an AI. They are like passwords.

## Step 2 — Put the keys in the project (your laptop)

1. In the project folder, create a file called **`.env.local`** (it is already ignored by git, so it can't be committed).
2. Paste this block and fill the blanks. Lines starting with `#` are optional.

```env
# --- Supabase (you already have these) ---
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# --- Mother's voice link (required). Make one: see "Make a secret" below ---
LISTEN_LINK_SECRET=

# --- Gnani (paste your keys, comma separated, no spaces) ---
GNANI_API_KEYS=key1,key2,key3

# --- WhatsApp (only if you use the WhatsApp bot) ---
# WHATSAPP_VERIFY_TOKEN=
# WHATSAPP_APP_SECRET=
# WHATSAPP_API_TOKEN=
# WHATSAPP_PHONE_NUMBER_ID=
# WHATSAPP_VOICE_REPLIES=1
```

**Make a secret** (for `LISTEN_LINK_SECRET` and `WHATSAPP_VERIFY_TOKEN`) — run this in a terminal and paste the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

3. Test the keys (costs a few credits). In the project folder:

```bash
npm install
npm run gnani:check
```

You should see **PASS** for Hindi, Marathi and Gujarati. If not, see "If something fails" below.

## Step 3 — Update the database (one paste)

Do this **before** putting the new code live.

1. Open the Supabase dashboard → your project → **SQL Editor** → **New query**.
2. Open the file **`supabase/apply-pending.sql`** from this repo, copy **everything**, paste it, press **Run**.
3. You should see **"Success. No rows returned"**. It is safe to run twice, and safe if some parts were already applied.
4. Check: Supabase → **Storage** → you should now see a **private** bucket called `tts-audio`.

(Prefer the command line? `npx supabase login`, then `npx supabase link --project-ref <your-ref>`, then `npx supabase db push`.)

## Step 4 — Put the keys on the live site (Vercel)

1. Vercel → your project → **Settings** → **Environment Variables**.
2. Add each variable (name on the left, value on the right), tick **Production** (and **Preview** if you use it), **Save**:

| Name | Value | Needed? |
|---|---|---|
| `GNANI_API_KEYS` | `key1,key2,key3` | **Yes** — turns Gnani on |
| `LISTEN_LINK_SECRET` | a long random secret (see above) | **Yes** — mothers' voice links |
| `NEXT_PUBLIC_SITE_URL` | your live address, e.g. `https://yourapp.vercel.app` | **Yes** |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Settings → API | **Yes** (should already be there) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase → Settings → API | **Yes** (should already be there) |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | from Meta developer console | Only for the WhatsApp bot |
| `WHATSAPP_VOICE_REPLIES` | `1` | Optional — bot also sends a spoken reply |
| `DEMO_MODE` | `1` | **Only** on a throw-away demo site (never on a real clinic site) |

3. **Redeploy** (important — changes only apply to a new deploy): Vercel → **Deployments** → the latest one → **⋯** → **Redeploy**.

> `NEXT_PUBLIC_…` values are baked in at build time, so always redeploy after changing them.
> Never put a Gnani key in a variable that starts with `NEXT_PUBLIC_` — that would publish it.

## Step 5 — Check it works on the live site

1. Sign in, then open `https://<your-site>/api/gnani/status`. You should see `"enabled": true` and `"keyCount": 3`.
2. Open a patient → press **Dictate**: the small badge should say **Gnani Prisma** (not "Browser"). Say: *"BP 130 by 80, weight 54 kilo, hemoglobin 9.5"* — the values should fill in.
3. Open a patient → **AI voice counselling** → play: the badge should say **Gnani Timbre**.
4. Use the "Listen" link from the WhatsApp message on a phone (not signed in): the mother's page should play the audio.

## If something fails

| You see | Meaning | Fix |
|---|---|---|
| `gnani:check` says "no key" | `.env.local` missing or key line empty | Redo Step 2; the line must be `GNANI_API_KEYS=...` with no spaces/quotes |
| `INVALID_API_KEY` / 401 | A key is wrong or was copied with a space | Copy the key again from app.gnani.ai |
| 402 / "insufficient credit" | The 5,000 credits are used up (or this isn't the registrant's account) | Sign in as the primary registrant; check credits in the dashboard |
| 429 / "rate limited" | Too many requests at once | Wait a minute; the app already queues requests and retries |
| Badge says **Browser** | Gnani not configured or temporarily failing — the app is using the fallback | Re-check Step 4 and **redeploy**; look at `/api/gnani/status` |
| Mother's link shows "not found" | `LISTEN_LINK_SECRET` missing/changed, or link expired (14 days) | Set it on Vercel, redeploy, send a fresh link |
| SQL error mentioning `private.current_clinic_id` | An older database migration was never applied | Run the earlier migrations in `supabase/migrations/` first (or `npx supabase db push`) |

## Prompts you can paste into an AI assistant (Claude / ChatGPT) if you get stuck

**Prompt 1 — set up locally**
> I'm setting up MatruSetu (Next.js + Supabase) with Gnani AI voice. Read `docs/GNANI_SETUP.md` in this repo. Check that my `.env.local` has the variables from Step 2 (do NOT print any secret values — only tell me which names are missing or empty). Then run `npm run gnani:check` and explain the result to me in simple words, step by step, with the exact fix if anything failed.

**Prompt 2 — Vercel**
> My MatruSetu site is on Vercel. Walk me through adding these environment variables in the Vercel dashboard and redeploying, one click at a time: GNANI_API_KEYS, LISTEN_LINK_SECRET, NEXT_PUBLIC_SITE_URL. Then tell me how to confirm Gnani is active using `/api/gnani/status`. Assume I am not technical.

**Prompt 3 — database**
> I need to run `supabase/apply-pending.sql` in the Supabase SQL Editor for a project that already has the earlier MatruSetu migrations. Tell me exactly where to click, what success looks like, and how to check that the `tts-audio` storage bucket exists. If I see an error, I will paste it and you tell me what it means.

## Hackathon demo tips

* Record the demo on a phone: **dictate a Marathi or Hinglish visit** (watch the vitals fill in), then **play a mother's counselling audio** from the WhatsApp link. Those two clips show regional languages, code-mixed speech and real-world impact.
* Post on LinkedIn or X with **#GnaniAI** and **#GreatIndianAIInternshipChallenge** and tag Gnani; submit the form before **10 November 2026**.
* Credits are limited (5,000): audio is cached, so replaying the same advice is free. Avoid recording long test dictations.

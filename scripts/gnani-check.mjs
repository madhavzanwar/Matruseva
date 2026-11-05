#!/usr/bin/env node
// Live smoke test for the Gnani (Vachana) speech APIs. Standalone: plain fetch,
// no TypeScript imports. Run: npm run gnani:check
//
// For Hindi, Marathi and Gujarati it (a) synthesises a counselling sentence with
// timbre-v3.0 (mp3), (b) transcribes the audio back with prisma-v3.0, (c) prints
// transcript / detected language / request ids / latencies / bytes and a PASS/FAIL
// with a normalised edit-distance similarity. Costs a few credits.
// Env: GNANI_API_KEYS (comma list) or GNANI_API_KEY, GNANI_BASE_URL (optional).
// Exit codes: 0 all pass, 1 failure, 2 not configured.

const keys = `${process.env.GNANI_API_KEYS ?? ""},${process.env.GNANI_API_KEY ?? ""}`
  .split(/[\s,]+/).map((k) => k.trim()).filter(Boolean);
const base = (process.env.GNANI_BASE_URL || "https://api.vachana.ai").replace(/\/+$/, "");
const THRESHOLD = 0.6;

if (keys.length === 0) {
  console.error(
    "Gnani is not configured.\n" +
      "Set GNANI_API_KEYS (comma separated; or GNANI_API_KEY) in .env.local, e.g.\n" +
      "  GNANI_API_KEYS=key1,key2,key3\n" +
      "then run `npm run gnani:check`. Keys are server-only: never commit them or prefix with NEXT_PUBLIC_.",
  );
  process.exit(2);
}
const key = keys[0];

const CASES = [
  { name: "Hindi", language: "hi-IN", text: "कृपया रोज़ एक आयरन की गोली खाएं और खूब पानी पिएं।" },
  { name: "Marathi", language: "mr-IN", text: "कृपया दररोज एक लोहाची गोळी घ्या आणि भरपूर पाणी प्या." },
  { name: "Gujarati", language: "gu-IN", text: "કૃપા કરીને દરરોજ એક આયર્નની ગોળી લો અને પુષ્કળ પાણી પીઓ." },
];

function hint(status, code) {
  if (status === 401) return `Authentication failed (${code ?? "401"}): the API key is missing or invalid. Check GNANI_API_KEYS in .env.local.`;
  if (status === 402) return "Insufficient credit (402): the Gnani account is out of credits. Top up or use another key.";
  if (status === 403) return `Forbidden (${code ?? "403"}): this key lacks the STT/TTS scope. Ask Gnani to enable it.`;
  if (status === 429) return "Rate limited (429): some accounts allow only ONE active request at a time. Wait and retry.";
  return null;
}

class ApiError extends Error {
  constructor(step, status, code, body) {
    super(`${step} failed: HTTP ${status}${code ? ` ${code}` : ""}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function errorCode(body) {
  try {
    const j = JSON.parse(body);
    return j?.detail?.error_code ?? j?.error?.type ?? j?.code ?? undefined;
  } catch {
    return undefined;
  }
}

async function call(step, url, init) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, headers: { ...init.headers, "X-API-Key-ID": key }, signal: AbortSignal.timeout(45_000) });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(step, res.status, errorCode(body), body.slice(0, 300));
  }
  return { res, ms };
}

function similarity(a, b) {
  const norm = (s) => s.normalize("NFC").toLowerCase().replace(/[\p{P}\p{S}]/gu, "").replace(/\s+/g, " ").trim();
  const x = Array.from(norm(a)), y = Array.from(norm(b));
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

console.log(`Gnani check against ${base} (${keys.length} key(s) configured, using #1)\n`);
let failed = 0;
let fatal = false;

for (const c of CASES) {
  console.log(`== ${c.name} (${c.language}) ==`);
  try {
    const tts = await call("TTS", `${base}/api/v1/tts/inference`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: c.text, model: "timbre-v3.0", voice: "Shivani", language: c.language,
        audio_config: { sample_rate: 24000, container: "mp3", bitrate: "64k" },
      }),
    });
    const audio = Buffer.from(await tts.res.arrayBuffer());
    console.log(`  TTS  ${tts.ms} ms, ${audio.length} bytes, ${tts.res.headers.get("content-type")}`);

    const form = new FormData();
    form.set("audio_file", new Blob([audio], { type: "audio/mpeg" }), "check.mp3");
    form.set("model", "prisma-v3.0");
    form.set("language_code", c.language);
    form.set("format", "transcribe");
    const stt = await call("STT", `${base}/stt/v3`, { method: "POST", body: form });
    const j = await stt.res.json();
    const score = similarity(c.text, j.transcript ?? "");
    console.log(`  STT  ${stt.ms} ms (server ${j.end_to_end_latency ?? "?"} s), request_id=${j.request_id ?? "-"}, detected=${j.detected_language_code ?? "-"}`);
    console.log(`  expected:   ${c.text}`);
    console.log(`  transcript: ${j.transcript}`);
    const pass = score >= THRESHOLD;
    if (!pass) failed++;
    console.log(`  ${pass ? "PASS" : "FAIL"} similarity=${score.toFixed(2)} (threshold ${THRESHOLD})\n`);
  } catch (e) {
    failed++;
    if (e instanceof ApiError) {
      console.log(`  FAIL ${e.message}`);
      const h = hint(e.status, e.code);
      if (h) console.log(`  -> ${h}`);
      else if (e.body) console.log(`  body: ${e.body}`);
      if ([401, 402, 403].includes(e.status)) fatal = true;
    } else {
      console.log(`  FAIL ${e instanceof Error ? e.message : String(e)} (network/timeout; is ${base} reachable?)`);
    }
    console.log();
    if (fatal) break;
  }
}

console.log(failed === 0 ? "All checks passed." : `${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);

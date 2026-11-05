import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));
const getCurrentUser = vi.fn();
let demoActive = true;
vi.mock("@/lib/auth", () => ({ getCurrentUser: () => getCurrentUser(), isDemoActive: () => demoActive }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

// Minimal chainable fake of the supabase query builder (thenable like the real one).
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { patients: [], visits: [], clinics: [] };
function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: rows()[0] ?? null }),
        then: (res: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: rows() }).then(res),
      };
      return q;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeDb() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeDb() }));

import { GET as staffGET } from "@/app/api/gnani/tts/counsel/route";
import { GET as motherGET } from "@/app/listen/[token]/audio/route";
import { createListenToken } from "@/lib/listenLink";
import { startMockGnani, type MockGnani } from "./test-utils/mockGnani";
import { resetSharedPool } from "./pool";
import { resetLimiter } from "./limits";
import { resetCounselAudioCache, getCounselManifest } from "./counselAudio";
import { loadCounselingDataForToken } from "@/lib/counselingData";

const PID = "p1-pooja-deshmukh"; // demo patient
const UUID = "11111111-1111-4111-8111-111111111111";
const CLINIC = "22222222-2222-4222-8222-222222222222";
const OTHER_CLINIC = "33333333-3333-4333-8333-333333333333";

let mock: MockGnani;
beforeAll(async () => {
  mock = await startMockGnani({ validKeys: ["k1"] });
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterAll(() => mock.close());
beforeEach(() => {
  mock.requests.length = 0;
  demoActive = true;
  tables.patients = [{ id: UUID, name: "Asha", age: 25, lmp: "2026-06-01", clinic_id: CLINIC }];
  tables.visits = [{ patient_id: UUID, bp_sys: 118, bp_dia: 76, hb: 11.2, fhr: 140, visit_date: "2026-10-01" }];
  tables.clinics = [{ id: CLINIC, name: "Clinic A" }];
  getCurrentUser.mockResolvedValue({ userId: "u1", clinicId: CLINIC, role: "doctor" });
  vi.stubEnv("GNANI_API_KEYS", "k1");
  vi.stubEnv("GNANI_BASE_URL", mock.url);
  vi.stubEnv("LISTEN_LINK_SECRET", "test-secret");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetSharedPool();
  resetLimiter();
  resetCounselAudioCache();
});
afterEach(() => vi.unstubAllEnvs());

const staffUrl = (q: Record<string, string>) => `http://localhost/api/gnani/tts/counsel?${new URLSearchParams(q)}`;
const staff = (q: Record<string, string>, init?: RequestInit) => staffGET(new Request(staffUrl(q), init));
const mother = (token: string, q = "", init?: RequestInit) =>
  motherGET(new Request(`http://localhost/listen/${token}/audio${q}`, init), { params: Promise.resolve({ token }) });
const tokenFor = (lang: "hi" | "mr" | "gu" | "en" = "hi", pid = PID, ttl?: number) => createListenToken(pid, lang, ttl);

describe("staff route GET /api/gnani/tts/counsel", () => {
  it("401 when unauthenticated", async () => {
    getCurrentUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const res = await staff({ patientId: PID, lang: "hi" });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, code: "unauthenticated", retryable: false });
  });

  it("503 gnani_not_configured (also with the kill switch)", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    vi.stubEnv("GNANI_API_KEYS", "");
    const res = await staff({ patientId: PID, lang: "hi" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "gnani_not_configured", retryable: false });
    vi.stubEnv("GNANI_API_KEYS", "k1");
    vi.stubEnv("GNANI_ENABLED", "0");
    expect((await (await staff({ patientId: PID, lang: "hi" })).json()).code).toBe("gnani_not_configured");
  });

  it("manifest (demo mode): minimal JSON, no-store, no PII", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    const res = await staff({ patientId: PID, lang: "mr" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["language", "ok", "parts", "version"]);
    expect(body).toMatchObject({ ok: true, language: "mr" });
    expect(body.parts).toBeGreaterThan(1);
    expect(JSON.stringify(body)).not.toMatch(/Pooja|phone|\d{10}/);
    expect(mock.requests).toHaveLength(0); // a manifest never spends credits
  });

  it("audio part: mpeg bytes, immutable private caching, Range 206, cache hit on repeat", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    const res = await staff({ patientId: PID, lang: "hi", part: "0" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600, immutable");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].json).toMatchObject({ model: "timbre-v3.0", voice: "Shivani", language: "hi-IN", speed: 1 });

    const ranged = await staff({ patientId: PID, lang: "hi", part: "0" }, { headers: { range: "bytes=1-2" } });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get("content-range")).toBe("bytes 1-2/4");
    expect([...new Uint8Array(await ranged.arrayBuffer())]).toEqual([2, 3]);
    const suffix = await staff({ patientId: PID, lang: "hi", part: "0" }, { headers: { range: "bytes=-1" } });
    expect(suffix.headers.get("content-range")).toBe("bytes 3-3/4");
    const bad = await staff({ patientId: PID, lang: "hi", part: "0" }, { headers: { range: "bytes=9-" } });
    expect(bad.status).toBe(416);
    expect(mock.requests).toHaveLength(1); // everything after the first request came from the cache
  });

  it("400 for bad lang and bad / out-of-range part", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    expect((await staff({ patientId: PID, lang: "fr" })).status).toBe(400);
    expect((await staff({ patientId: PID })).status).toBe(400);
    for (const part of ["-1", "NaN", "1.5", "abc", "", "1e2", "99999", "0x1"]) {
      const res = await staff({ patientId: PID, lang: "hi", part });
      expect(res.status, `part=${part}`).toBe(400);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
    const parts = (await (await staff({ patientId: PID, lang: "hi" })).json()).parts;
    expect((await staff({ patientId: PID, lang: "hi", part: String(parts) })).status).toBe(400);
    expect((await staff({ patientId: PID, lang: "hi", part: String(parts - 1) })).status).toBe(200);
  });

  it("own-clinic patient works through the RLS client; another clinic's patient is 404", async () => {
    demoActive = false;
    const ok = await staff({ patientId: UUID, lang: "hi" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);

    getCurrentUser.mockResolvedValue({ userId: "u2", clinicId: OTHER_CLINIC, role: "doctor" });
    const denied = await staff({ patientId: UUID, lang: "hi", part: "0" });
    expect(denied.status).toBe(404);
    expect(await denied.json()).toMatchObject({ ok: false, code: "patient_not_found" });
    expect(mock.requests).toHaveLength(0); // no credits for someone else's patient
    // not a uuid / unknown patient
    expect((await staff({ patientId: "nope", lang: "hi" })).status).toBe(404);
    expect((await staff({ patientId: "44444444-4444-4444-8444-444444444444", lang: "hi" })).status).toBe(404);
  });

  it("429 rate_limited on cache misses with Retry-After; budget_exceeded", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    vi.stubEnv("GNANI_TTS_PER_MINUTE", "2"); // manifest call + one miss
    expect((await staff({ patientId: PID, lang: "hi" })).status).toBe(200);
    expect((await staff({ patientId: PID, lang: "hi", part: "0" })).status).toBe(200);
    const limited = await staff({ patientId: PID, lang: "hi", part: "1" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: "rate_limited", retryable: true });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // the cached part is still served
    expect((await staff({ patientId: PID, lang: "hi", part: "0" })).status).toBe(200);

    resetLimiter();
    vi.stubEnv("GNANI_TTS_PER_MINUTE", "60");
    vi.stubEnv("GNANI_TTS_DAILY_CHARS_PER_USER", "5");
    const over = await staff({ patientId: PID, lang: "en", part: "0" });
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ code: "budget_exceeded", retryable: true });
  });

  it("maps upstream failures to gnani_unavailable (browser fallback) without leaking details", async () => {
    getCurrentUser.mockResolvedValue({ userId: "demo-doctor-id", isDemo: true, clinicId: "demo-clinic-id" });
    mock.setCreditExhausted(true);
    const res = await staff({ patientId: PID, lang: "hi", part: "0" });
    mock.setCreditExhausted(false);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, code: "gnani_unavailable" });
    expect(JSON.stringify(body)).not.toContain("k1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("mother route GET /listen/[token]/audio", () => {
  it("404 with an empty body for invalid, tampered and expired tokens (and a missing secret)", async () => {
    const good = tokenFor("hi");
    const [p, sig] = good.split(".");
    const expired = tokenFor("hi", PID, -60);
    vi.stubEnv("LISTEN_LINK_SECRET", "test-secret");
    for (const token of ["garbage", "a.b", `${p}x.${sig}`, `${p}.${sig}x`, expired, ""]) {
      const res = await mother(token, "?part=0");
      expect(res.status, token).toBe(404);
      expect(await res.text()).toBe("");
    }
    expect(mock.requests).toHaveLength(0);
  });

  it("404 (same shape) when the token is genuine but the patient is gone", async () => {
    demoActive = false;
    const res = await mother(tokenFor("hi", "44444444-4444-4444-8444-444444444444"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("manifest uses the token's language and ignores ?lang=", async () => {
    const token = tokenFor("gu");
    const res = await mother(token, "?lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, language: "gu" });
    const expected = getCounselManifest((await loadCounselingDataForToken(PID, { demo: true }))!, "gu");
    expect(body.parts).toBe(expected.parts);
    expect(body.version).toBe(expected.version);
    expect(JSON.stringify(body)).not.toMatch(/Pooja|phone/i);
  });

  it("part: audio/mpeg with the token's language sent to Gnani, immutable private caching", async () => {
    const res = await mother(tokenFor("mr"), "?part=0&lang=en");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600, immutable");
    expect(mock.requests[0].json).toMatchObject({ language: "mr-IN", voice: "Shivani" });
    expect(String(mock.requests[0].json?.text)).toMatch(/[ऀ-ॿ]/);
  });

  it("400 for invalid part values; 503 when Gnani is not configured", async () => {
    const token = tokenFor("hi");
    for (const q of ["?part=-1", "?part=NaN", "?part=1.2", "?part=100000", "?part=5000"]) {
      expect((await mother(token, q)).status, q).toBe(400);
    }
    vi.stubEnv("GNANI_API_KEYS", "");
    const res = await mother(token);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "gnani_not_configured", retryable: false });
  });

  it("rate limits per patient (shared across callers of the same link), not per caller", async () => {
    vi.stubEnv("GNANI_TTS_PER_MINUTE", "2");
    const token = tokenFor("hi");
    expect((await mother(token)).status).toBe(200);
    expect((await mother(token, "?part=0")).status).toBe(200);
    const res = await mother(token, "?part=1");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    // a different patient has its own allowance
    expect((await mother(tokenFor("hi", "p2-sunita-verma"))).status).toBe(200);
  });
});

describe("counselingData loader", () => {
  it("returns only minimal fields: never the phone or address", async () => {
    tables.patients = [{ id: UUID, name: "Asha", age: 25, lmp: "2026-06-01", clinic_id: CLINIC, phone: "9876543210", address: "Somewhere" }];
    const { loadCounselingDataForStaff } = await import("@/lib/counselingData");
    const data = await loadCounselingDataForStaff(fakeDb() as never, UUID, { demo: false, clinicId: CLINIC });
    expect(data).toMatchObject({ patientId: UUID, patientName: "Asha", phone: null, bpSys: 118, hb: 11.2, clinicName: "Clinic A" });
    expect(JSON.stringify(data)).not.toMatch(/9876543210|Somewhere/);
    expect(await loadCounselingDataForStaff(fakeDb() as never, UUID, { demo: false, clinicId: OTHER_CLINIC })).toBeNull();
    expect(await loadCounselingDataForStaff(null, UUID, { demo: false })).toBeNull();
  });
});

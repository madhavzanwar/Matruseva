import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CounselLimitError,
  CounselPartError,
  LruCache,
  MEMORY_CACHE_PARTS,
  getCounselAudioPart,
  getCounselManifest,
  resetCounselAudioCache,
  type AudioStore,
  type CounselAudioDeps,
} from "./counselAudio";
import { GnaniLimiter } from "./limits";
import { getGnaniConfig } from "./config";
import { generateCounseling, type CounselingPatientData } from "@/lib/voiceCounselor";
import { splitForTts } from "./languages";

const patient: CounselingPatientData = {
  patientId: "pat-1",
  patientName: "Sunita",
  phone: null,
  age: 27,
  gaWeeks: 30,
  bpSys: 150,
  bpDia: 95,
  hb: 9.2,
  fhr: 140,
  clinicName: "Test Clinic",
};

const limits = { sttPerMinute: 20, ttsPerMinute: 60, sttDailySecondsPerUser: 1800, ttsDailyCharsPerUser: 30000, sttDailySecondsGlobal: 7200, ttsDailyCharsGlobal: 200000 };
const mkLimiter = (over: Partial<typeof limits> = {}) => new GnaniLimiter(() => ({ ...limits, ...over }));

function fakeSynth() {
  const calls: Array<{ text: string; voice?: string; language: string; speed?: unknown; container: string }> = [];
  const fn = vi.fn(async (input: { text: string; voice?: string; language: string; speed?: unknown; container: string }) => {
    calls.push(input);
    return { audio: Buffer.from(`mp3:${input.text.slice(0, 8)}:${calls.length}`), contentType: "audio/mpeg" };
  });
  return { fn, calls };
}
function memStore(opts: { failGet?: boolean; failPut?: boolean } = {}) {
  const m = new Map<string, Buffer>();
  const store: AudioStore = {
    async get(k) {
      if (opts.failGet) throw new Error("boom");
      return m.get(k) ?? null;
    },
    async put(k, b) {
      if (opts.failPut) throw new Error("boom");
      m.set(k, b);
    },
  };
  return { store, m };
}
function deps(over: Partial<CounselAudioDeps> & { synth?: ReturnType<typeof fakeSynth> } = {}) {
  const synth = over.synth ?? fakeSynth();
  const d: CounselAudioDeps = {
    config: { ...getGnaniConfig(), enabled: true, keys: ["k"] },
    limiter: mkLimiter(),
    store: null,
    memory: new LruCache(MEMORY_CACHE_PARTS),
    budgetKey: "public:pat-1",
    synthesize: synth.fn as unknown as CounselAudioDeps["synthesize"],
    ...over,
  };
  delete (d as { synth?: unknown }).synth;
  return { d, synth };
}

beforeEach(() => resetCounselAudioCache());

describe("manifest", () => {
  it("is deterministic and matches splitForTts of the server-built script", () => {
    const a = getCounselManifest(patient, "hi");
    const b = getCounselManifest({ ...patient }, "hi");
    expect(a).toEqual(b);
    expect(a.parts).toBe(splitForTts(generateCounseling(patient, "hi").speechText, 350).length);
    expect(a.parts).toBeGreaterThan(1);
    expect(a.model).toBe("timbre-v3.0");
    expect(a.voice).toBe("Shivani");
    expect(a.language).toBe("hi");
  });
  it("version changes with the advice and with the language", () => {
    const base = getCounselManifest(patient, "hi").version;
    expect(getCounselManifest({ ...patient, hb: 12.5 }, "hi").version).not.toBe(base);
    expect(getCounselManifest(patient, "mr").version).not.toBe(base);
    expect(getCounselManifest(patient, "gu").parts).toBeGreaterThan(0);
    expect(getCounselManifest(patient, "en").parts).toBeGreaterThan(0);
  });
  it("carries no phone / text", () => {
    const json = JSON.stringify(getCounselManifest({ ...patient, phone: "9876543210" }, "en"));
    expect(json).not.toContain("9876543210");
    expect(json).not.toContain("Sunita");
  });
});

describe("getCounselAudioPart", () => {
  it("synthesises exactly the server-built part text with fixed voice, speed 1.0 and mp3", async () => {
    const { d, synth } = deps();
    const parts = splitForTts(generateCounseling(patient, "hi").speechText, 350);
    const r = await getCounselAudioPart(patient, "hi", 1, d);
    expect(r.cacheHit).toBe(false);
    expect(r.contentType).toBe("audio/mpeg");
    expect(synth.calls).toHaveLength(1);
    expect(synth.calls[0]).toMatchObject({ text: parts[1], voice: "Shivani", language: "hi-IN", speed: 1, container: "mp3" });
    expect(synth.calls[0].text.length).toBeLessThanOrEqual(350);
  });

  it("memory hit: no second synthesis and no budget use", async () => {
    const { d, synth } = deps();
    await getCounselAudioPart(patient, "hi", 0, d);
    const used = d.limiter!.budgetRemaining("public:pat-1").ttsChars;
    const again = await getCounselAudioPart(patient, "hi", 0, d);
    expect(again.cacheHit).toBe(true);
    expect(synth.fn).toHaveBeenCalledTimes(1);
    expect(d.limiter!.budgetRemaining("public:pat-1").ttsChars).toBe(used);
  });

  it("consumes the char budget only on a miss, equal to the part length", async () => {
    const { d } = deps();
    const text = splitForTts(generateCounseling(patient, "hi").speechText, 350)[0];
    const before = d.limiter!.budgetRemaining("public:pat-1").ttsChars;
    await getCounselAudioPart(patient, "hi", 0, d);
    expect(before - d.limiter!.budgetRemaining("public:pat-1").ttsChars).toBe(text.length);
  });

  it("storage hit (fresh memory) serves without synthesising or charging", async () => {
    const { store } = memStore();
    const first = deps({ store });
    await getCounselAudioPart(patient, "mr", 0, first.d);
    expect(first.synth.fn).toHaveBeenCalledTimes(1);

    const second = deps({ store }); // new process: empty memory, new limiter
    const r = await getCounselAudioPart(patient, "mr", 0, second.d);
    expect(r.cacheHit).toBe(true);
    expect(second.synth.fn).not.toHaveBeenCalled();
    expect(second.d.limiter!.budgetRemaining("public:pat-1").ttsChars).toBe(30000);
    expect(second.d.memory!.size).toBe(1); // promoted into the LRU
  });

  it("serves synthesised audio even when storage get and put both fail", async () => {
    const { store } = memStore({ failGet: true, failPut: true });
    const { d } = deps({ store });
    const r = await getCounselAudioPart(patient, "gu", 0, d);
    expect(r.audio.length).toBeGreaterThan(0);
    expect(r.cacheHit).toBe(false);
  });

  it("stores the part under a text-free key", async () => {
    const { store, m } = memStore();
    await getCounselAudioPart(patient, "hi", 0, deps({ store }).d);
    const [key] = [...m.keys()];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the same advice for different patients/identities shares the cache entry but each identity pays only on its own miss", async () => {
    const { store } = memStore();
    const a = deps({ store, budgetKey: "u-1" });
    await getCounselAudioPart(patient, "hi", 0, a.d);
    const b = deps({ store, budgetKey: "u-2" });
    const r = await getCounselAudioPart(patient, "hi", 0, b.d);
    expect(r.cacheHit).toBe(true);
    expect(b.d.limiter!.budgetRemaining("u-2").ttsChars).toBe(30000);
  });

  it("dedupes concurrent identical misses into one synthesis", async () => {
    const { d, synth } = deps();
    const [a, b] = await Promise.all([getCounselAudioPart(patient, "hi", 2, d), getCounselAudioPart(patient, "hi", 2, d)]);
    expect(synth.fn).toHaveBeenCalledTimes(1);
    expect([a.cacheHit, b.cacheHit].sort()).toEqual([false, true]);
  });

  it("budget_exceeded / rate_limited are typed and nothing is synthesised", async () => {
    const tiny = deps({ limiter: mkLimiter({ ttsDailyCharsPerUser: 10 }) });
    await expect(getCounselAudioPart(patient, "hi", 0, tiny.d)).rejects.toMatchObject({ code: "budget_exceeded" });
    expect(tiny.synth.fn).not.toHaveBeenCalled();

    const slow = deps({ limiter: mkLimiter({ ttsPerMinute: 1 }) });
    await getCounselAudioPart(patient, "hi", 0, slow.d);
    const err = await getCounselAudioPart(patient, "hi", 1, slow.d).catch((e) => e);
    expect(err).toBeInstanceOf(CounselLimitError);
    expect(err).toMatchObject({ code: "rate_limited" });
    expect(err.retryAfterSec).toBeGreaterThan(0);
    // cache hits are never rate limited
    expect((await getCounselAudioPart(patient, "hi", 0, slow.d)).cacheHit).toBe(true);
  });

  it("refunds the budget when synthesis fails", async () => {
    const synth = { fn: vi.fn(async () => { throw new Error("upstream"); }), calls: [] } as unknown as ReturnType<typeof fakeSynth>;
    const { d } = deps({ synth });
    await expect(getCounselAudioPart(patient, "hi", 0, d)).rejects.toThrow("upstream");
    expect(d.limiter!.budgetRemaining("public:pat-1").ttsChars).toBe(30000);
    expect(d.memory!.size).toBe(0);
  });

  it("rejects bad part indexes", async () => {
    const { d } = deps();
    const n = getCounselManifest(patient, "hi").parts;
    for (const bad of [-1, 1.5, Number.NaN, n, 9999]) {
      await expect(getCounselAudioPart(patient, "hi", bad, d)).rejects.toBeInstanceOf(CounselPartError);
    }
  });
});

describe("LruCache", () => {
  it("evicts the least recently used entry", () => {
    const c = new LruCache<number>(3);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.get("a")).toBe(1); // a is now most recent
    c.set("d", 4); // evicts b
    expect(c.has("b")).toBe(false);
    expect([c.has("a"), c.has("c"), c.has("d")]).toEqual([true, true, true]);
    expect(c.size).toBe(3);
  });
  it("is bounded in the audio cache (~50 parts)", async () => {
    const memory = new LruCache<Buffer>(2);
    const { d, synth } = deps({ memory });
    await getCounselAudioPart(patient, "hi", 0, d);
    await getCounselAudioPart(patient, "hi", 1, d);
    await getCounselAudioPart(patient, "hi", 2, d); // evicts part 0
    expect(memory.size).toBe(2);
    await getCounselAudioPart(patient, "hi", 0, d); // synthesises again (no store)
    expect(synth.fn).toHaveBeenCalledTimes(4);
    expect(MEMORY_CACHE_PARTS).toBe(50);
  });
});

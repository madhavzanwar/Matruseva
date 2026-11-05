import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { toGnaniLanguage, fromGnaniLanguage, defaultVoiceFor, splitForTts, STAFF_LOCALE_TO_GNANI } from "./languages";
import { ttsCacheKey } from "./ttsCacheKey";

describe("language mapping", () => {
  it("maps both ways", () => {
    expect(toGnaniLanguage("en")).toBe("en-IN");
    expect(toGnaniLanguage("gu")).toBe("gu-IN");
    expect(toGnaniLanguage("ta")).toBeNull();
    expect(fromGnaniLanguage("mr-IN")).toBe("mr");
    expect(fromGnaniLanguage("ta-IN")).toBeNull();
    expect(STAFF_LOCALE_TO_GNANI).toEqual({ en: "en-IN", hi: "hi-IN", mr: "mr-IN" });
    expect(defaultVoiceFor("male")).toBe("Avinash");
    expect(defaultVoiceFor()).toBe("Shivani");
  });
});

describe("splitForTts", () => {
  it("splits on danda and keeps order", () => {
    const t = "आपका स्वागत है। कृपया आयरन की गोली लें। पानी पिएं।";
    expect(splitForTts(t, 25)).toEqual(["आपका स्वागत है।", "कृपया आयरन की गोली लें।", "पानी पिएं।"]);
  });
  it("packs short sentences", () => {
    expect(splitForTts("A one. B two! C three?", 350)).toEqual(["A one. B two! C three?"]);
  });
  it("does not split decimals", () => {
    expect(splitForTts("Hb is 10.5 today. Take iron.", 20)).toEqual(["Hb is 10.5 today.", "Take iron."]);
  });
  it("handles Gujarati and newlines", () => {
    const out = splitForTts("તમારું સ્વાગત છે.\nઆયર્નની ગોળી લો?", 20);
    expect(out).toEqual(["તમારું સ્વાગત છે.", "આયર્નની ગોળી લો?"]);
  });
  it("splits very long sentences at commas then spaces, never inside words", () => {
    const words = Array.from({ length: 200 }, (_, i) => `शब्द${i}`);
    const text = words.join(" ");
    const chunks = splitForTts(text, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(" ").split(" ")).toEqual(words);
    const commas = splitForTts("alpha beta, gamma delta, epsilon zeta", 20);
    expect(commas).toEqual(["alpha beta,", "gamma delta,", "epsilon zeta"]);
  });
  it("keeps an unbreakable word whole and ignores empty input", () => {
    expect(splitForTts("x".repeat(100), 30)).toEqual(["x".repeat(100)]);
    expect(splitForTts("  \n ")).toEqual([]);
  });
});

describe("ttsCacheKey", () => {
  const base = { text: "hi", voice: "Shivani", language: "hi-IN", model: "timbre-v3.0", speed: 1, container: "mp3" };
  it("is stable and sensitive to every field", () => {
    expect(ttsCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(ttsCacheKey(base)).toBe(ttsCacheKey({ ...base }));
    for (const patch of [{ text: "hj" }, { voice: "Avinash" }, { language: "mr-IN" }, { model: "timbre-v2.5" }, { speed: 1.1 }, { container: "ogg" }]) {
      expect(ttsCacheKey({ ...base, ...patch })).not.toBe(ttsCacheKey(base));
    }
  });
});

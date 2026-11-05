import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GnaniLimiter, estimateAudioSeconds } from "./limits";

const limits = { sttPerMinute: 2, ttsPerMinute: 3, sttDailySecondsPerUser: 60, ttsDailyCharsPerUser: 100, sttDailySecondsGlobal: 80, ttsDailyCharsGlobal: 150 };
function mk() {
  let t = Date.UTC(2026, 0, 1, 10, 0, 0);
  const l = new GnaniLimiter(() => limits, () => t);
  return { l, advance: (ms: number) => void (t += ms) };
}

describe("GnaniLimiter", () => {
  it("sliding window per user and kind", () => {
    const { l, advance } = mk();
    expect(l.checkRate("u", "stt").ok).toBe(true);
    expect(l.checkRate("u", "stt").ok).toBe(true);
    const r = l.checkRate("u", "stt");
    expect(r).toMatchObject({ ok: false, code: "rate_limited" });
    expect(l.checkRate("other", "stt").ok).toBe(true);
    expect(l.checkRate("u", "tts").ok).toBe(true);
    advance(61_000);
    expect(l.checkRate("u", "stt").ok).toBe(true);
  });
  it("per-user and global daily budgets, refund, day rollover", () => {
    const { l, advance } = mk();
    expect(l.consumeBudget("a", "stt", 50).ok).toBe(true);
    expect(l.consumeBudget("a", "stt", 20)).toMatchObject({ ok: false, code: "budget_exceeded" });
    expect(l.consumeBudget("b", "stt", 30).ok).toBe(true);
    expect(l.consumeBudget("c", "stt", 5)).toMatchObject({ ok: false, code: "budget_exceeded" }); // global 80
    expect(l.budgetRemaining("a").sttSeconds).toBe(0);
    l.refundBudget("b", "stt", 30);
    expect(l.consumeBudget("c", "stt", 5).ok).toBe(true);
    advance(24 * 3600_000);
    expect(l.budgetRemaining("a")).toEqual({ sttSeconds: 60, ttsChars: 100 });
  });
});

describe("estimateAudioSeconds", () => {
  it("reads WAV header byte rate", () => {
    const b = new Uint8Array(44 + 32000 * 5);
    b.set([82, 73, 70, 70]);
    new DataView(b.buffer).setUint32(28, 32000, true);
    expect(estimateAudioSeconds(b, "audio/wav")).toBeCloseTo(5, 5);
    expect(estimateAudioSeconds(new Uint8Array(160_000), "audio/mpeg")).toBeCloseTo(10, 5);
  });
});

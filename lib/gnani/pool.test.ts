import { describe, it, expect } from "vitest";
import { KeyPool } from "./pool";
import { GnaniError } from "./errors";

const tick = () => new Promise<void>((r) => setTimeout(r, 5));
function mk(keys: string[], extra: Partial<ConstructorParameters<typeof KeyPool>[0]> = {}) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const pool = new KeyPool({ keys, now: () => t, sleep: async (ms) => void sleeps.push(ms), ...extra });
  return { pool, sleeps, advance: (ms: number) => void (t += ms) };
}
const err = (kind: ConstructorParameters<typeof GnaniError>[0]["kind"]) => new GnaniError({ kind });

describe("KeyPool", () => {
  it("never runs more than 1 call per key", async () => {
    const { pool } = mk(["a", "b"]);
    const inflight = new Map<string, number>();
    let max = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        pool.run(async ({ key }) => {
          inflight.set(key, (inflight.get(key) ?? 0) + 1);
          max = Math.max(max, inflight.get(key)!);
          await tick();
          inflight.set(key, inflight.get(key)! - 1);
        }),
      ),
    );
    expect(max).toBe(1);
  });
  it("serves waiters FIFO", async () => {
    const { pool } = mk(["a"]);
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4].map((n) => pool.run(async () => { await tick(); order.push(n); })));
    expect(order).toEqual([1, 2, 3, 4]);
  });
  it("retries 429 with 0.5s,1s,2s backoff then gives up", async () => {
    const { pool, sleeps } = mk(["a"]);
    let calls = 0;
    await expect(pool.run(async () => { calls++; throw err("rate_limited"); })).rejects.toMatchObject({ kind: "rate_limited" });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
  });
  it("recovers when a retry succeeds and prefers another key after 429", async () => {
    const { pool } = mk(["a", "b"]);
    const used: string[] = [];
    const r = await pool.run(async ({ key }) => {
      used.push(key);
      if (used.length === 1) throw err("rate_limited");
      return "ok";
    });
    expect(r).toBe("ok");
    expect(used[1]).not.toBe(used[0]);
  });
  it("does not retry non-retryable errors", async () => {
    const { pool, sleeps } = mk(["a"]);
    let calls = 0;
    await expect(pool.run(async () => { calls++; throw err("bad_request"); })).rejects.toMatchObject({ kind: "bad_request" });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });
  it("retries timeout/upstream/network", async () => {
    for (const kind of ["timeout", "upstream", "network"] as const) {
      const { pool } = mk(["a"]);
      let calls = 0;
      expect(await pool.run(async () => { if (++calls < 3) throw err(kind); return calls; })).toBe(3);
    }
  });
  it("respects the deadline", async () => {
    const { pool } = mk(["a"]);
    let calls = 0;
    await expect(pool.run(async () => { calls++; throw err("upstream"); }, { deadlineMs: 400 })).rejects.toBeDefined();
    expect(calls).toBe(1);
  });
  it("disables a key on 401 (10 min), fails over, and recovers", async () => {
    const { pool, advance } = mk(["bad", "good"]);
    const used: string[] = [];
    const r = await pool.run(async ({ key }) => { used.push(key); if (key === "bad") throw err("auth"); return key; });
    expect(r).toBe("good");
    expect(pool.getStatus().availableKeys).toBe(1);
    await pool.run(async ({ key }) => used.push(key));
    expect(used.filter((k) => k === "bad")).toHaveLength(1); // not used again
    advance(10 * 60_000 + 1);
    expect(pool.getStatus().availableKeys).toBe(2);
  });
  it("fails fast when all keys are disabled, opens circuit, recovers", async () => {
    const { pool, advance } = mk(["a"]);
    await expect(pool.run(async () => { throw err("forbidden"); })).rejects.toMatchObject({ kind: "auth", code: "ALL_KEYS_DISABLED" });
    expect(pool.getStatus().circuitOpen).toBe(true);
    let called = false;
    await expect(pool.run(async () => { called = true; })).rejects.toMatchObject({ kind: "auth" });
    expect(called).toBe(false);
    advance(10 * 60_000 + 1);
    expect(await pool.run(async () => "ok")).toBe("ok");
    expect(pool.getStatus().circuitOpen).toBe(false);
  });
  it("402 marks all keys exhausted for 5 minutes and fails fast incl. queued waiters", async () => {
    const { pool, advance } = mk(["a", "b"]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p1 = pool.run(async () => { await gate; throw err("credit"); });
    const p2 = pool.run(async () => { await gate; return 1; });
    const p3 = pool.run(async () => "queued");
    const r3 = expect(p3).rejects.toMatchObject({ kind: "credit" });
    await tick();
    release();
    await expect(p1).rejects.toMatchObject({ kind: "credit" });
    await p2;
    await r3;
    expect(pool.getStatus()).toMatchObject({ circuitOpen: true, creditExhausted: true });
    let called = false;
    await expect(pool.run(async () => { called = true; })).rejects.toMatchObject({ kind: "credit" });
    expect(called).toBe(false);
    advance(5 * 60_000 + 1);
    expect(await pool.run(async () => "ok")).toBe("ok");
  });
  it("rejects beyond the queue cap and after max wait", async () => {
    const { pool } = mk(["a"], { maxQueue: 2, maxWaitMs: 30 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const busy = pool.run(() => gate);
    const q1 = pool.run(async () => 1);
    const q2 = pool.run(async () => 2);
    await expect(pool.run(async () => 3)).rejects.toMatchObject({ kind: "rate_limited", code: "QUEUE_FULL" });
    await expect(q1).rejects.toMatchObject({ code: "QUEUE_TIMEOUT" });
    await expect(q2).rejects.toMatchObject({ code: "QUEUE_TIMEOUT" });
    release();
    await busy;
  });
  it("no keys => not_configured", async () => {
    await expect(mk([]).pool.run(async () => 1)).rejects.toMatchObject({ kind: "not_configured" });
  });
});

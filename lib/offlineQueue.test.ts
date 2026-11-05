import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  backoffMs,
  classifyError,
  createMemoryStorage,
  createQueue,
  dueEntries,
  flushQueue,
  isNetworkError,
  nextRetryAt,
  pickPayload,
  setOfflineUserId,
} from "./offlineQueue";
import { submitOrQueue } from "./offlineSubmit";
import { setOfflineTranslator } from "./offlineI18n";
import { makeTranslator } from "./i18n/translate";

setOfflineTranslator(makeTranslator("en"));

function setup(start = 1_000) {
  let t = start;
  let n = 0;
  const queue = createQueue(createMemoryStorage(), { now: () => t, uuid: () => `id-${++n}` });
  return { queue, advance: (ms: number) => (t += ms), now: () => t };
}

describe("payload whitelist", () => {
  it("keeps only known string fields", () => {
    expect(pickPayload("contact", { channel: "call", outcome: "reached", secret: "x", reason: "", notes: 5 })).toEqual({
      channel: "call",
      outcome: "reached",
    });
  });
});

describe("queue basics", () => {
  it("enqueues FIFO with strictly increasing createdAt", async () => {
    const { queue } = setup();
    await queue.enqueue({ type: "visit", patientId: "p1", payload: { bpSys: "120" } });
    await queue.enqueue({ type: "contact", patientId: "p2", payload: { channel: "call", outcome: "reached" } });
    await queue.enqueue({ type: "visit", patientId: "p1", payload: { bpSys: "130" } });
    const list = await queue.list();
    expect(list.map((e) => e.id)).toEqual(["id-1", "id-2", "id-3"]);
    expect(list[0].createdAt).toBeLessThan(list[1].createdAt);
    expect(list.every((e) => e.status === "pending" && e.attempts === 0)).toBe(true);
  });

  it("is idempotent for the same id", async () => {
    const { queue } = setup();
    await queue.enqueue({ id: "same", type: "visit", patientId: "p1", payload: {} });
    await queue.enqueue({ id: "same", type: "visit", patientId: "p1", payload: {} });
    expect(await queue.list()).toHaveLength(1);
  });

  it("markFailed, retry and remove", async () => {
    const { queue } = setup();
    const e = await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    await queue.markFailed(e.id, "bad");
    expect((await queue.list())[0]).toMatchObject({ status: "failed", lastError: "bad" });
    await queue.retry(e.id);
    expect((await queue.list())[0]).toMatchObject({ status: "pending", attempts: 0 });
    await queue.remove(e.id);
    expect(await queue.list()).toEqual([]);
  });

  it("markRetryLater applies backoff and eventually fails", async () => {
    const { queue, now } = setup();
    const e = await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    await queue.markRetryLater(e.id, "net");
    let cur = (await queue.list())[0];
    expect(cur.nextAttemptAt).toBe(now() + backoffMs(1));
    expect(dueEntries([cur], now())).toHaveLength(0);
    expect(nextRetryAt([cur])).toBe(cur.nextAttemptAt);
    for (let i = 1; i < MAX_ATTEMPTS; i++) await queue.markRetryLater(e.id, "net");
    cur = (await queue.list())[0];
    expect(cur.status).toBe("failed");
  });
});

describe("backoff and classification", () => {
  it("doubles and caps", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(50)).toBe(5 * 60_000);
  });

  it("recognises network errors but not code bugs", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("fetch failed"))).toBe(true);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
  });

  it("classifies returned and thrown errors", () => {
    expect(classifyError("Database connection failed")).toBe("transient");
    expect(classifyError("new row violates row-level security policy")).toBe("permanent");
    expect(classifyError("Number must be greater than 0")).toBe("permanent");
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyError(new Error("An error occurred in the Server Components render"))).toBe("transient");
  });
});

describe("flushQueue", () => {
  it("sends FIFO and removes successes", async () => {
    const { queue, now } = setup();
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    await queue.enqueue({ type: "contact", patientId: "p1", payload: {} });
    const order: string[] = [];
    const res = await flushQueue(queue, async (e) => (order.push(e.id), { error: null }), { now });
    expect(order).toEqual(["id-1", "id-2"]);
    expect(res).toEqual({ sent: 2, failed: 0, stopped: false });
    expect(await queue.list()).toEqual([]);
  });

  it("only replays the current user's entries and drops the rest", async () => {
    const { queue, now } = setup();
    setOfflineUserId("userA");
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    setOfflineUserId("userB");
    await queue.enqueue({ type: "visit", patientId: "p2", payload: {} });
    setOfflineUserId(null);
    const sent: string[] = [];
    await flushQueue(queue, async (e) => (sent.push(e.patientId), { error: null }), { now, userId: "userB" });
    expect(sent).toEqual(["p2"]);
    expect(await queue.list()).toEqual([]);
  });

  it("stops on network error, keeps order and backs off", async () => {
    const { queue, now } = setup();
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    let calls = 0;
    const res = await flushQueue(
      queue,
      async () => {
        calls++;
        throw new TypeError("Failed to fetch");
      },
      { now },
    );
    expect(calls).toBe(1);
    expect(res.stopped).toBe(true);
    const list = await queue.list();
    expect(list.map((e) => e.status)).toEqual(["pending", "pending"]);
    expect(list[0].attempts).toBe(1);
    expect(list[0].nextAttemptAt).toBeGreaterThan(now());
    // Not due again until backoff elapses.
    const again = await flushQueue(queue, async () => ({ error: null }), { now });
    expect(again.sent).toBe(0);
  });

  it("marks permanent errors failed and continues with later entries", async () => {
    const { queue, now } = setup();
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    await queue.enqueue({ type: "contact", patientId: "p2", payload: {} });
    const res = await flushQueue(
      queue,
      async (e) => (e.id === "id-1" ? { error: "Number must be greater than 0" } : { error: null }),
      { now },
    );
    expect(res).toEqual({ sent: 1, failed: 1, stopped: false });
    const list = await queue.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "id-1", status: "failed", lastError: "Number must be greater than 0" });
  });

  it("does not run when offline", async () => {
    const { queue, now } = setup();
    await queue.enqueue({ type: "visit", patientId: "p1", payload: {} });
    let calls = 0;
    const res = await flushQueue(queue, async () => (calls++, { error: null }), { now, isOnline: () => false });
    expect(calls).toBe(0);
    expect(res.stopped).toBe(true);
  });
});

describe("submitOrQueue", () => {
  const base = { type: "visit" as const, patientId: "p1", fields: { bpSys: "120", junk: "x" } };

  it("queues when the browser is offline without calling the server", async () => {
    const { queue } = setup();
    let ran = false;
    const msgs: string[] = [];
    const r = await submitOrQueue({
      ...base,
      queue,
      isOnline: () => false,
      uuid: () => "k1",
      notify: (m) => msgs.push(m),
      run: async () => ((ran = true), { error: null }),
    });
    expect(r).toEqual({ error: null, queued: true });
    expect(ran).toBe(false);
    expect(msgs[0]).toMatch(/Saved offline/);
    const [e] = await queue.list();
    expect(e).toMatchObject({ id: "k1", payload: { bpSys: "120" } });
  });

  it("queues with the same key when the action throws a network error", async () => {
    const { queue } = setup();
    const r = await submitOrQueue({
      ...base,
      queue,
      isOnline: () => true,
      uuid: () => "k2",
      run: async (id) => {
        expect(id).toBe("k2");
        throw new TypeError("Failed to fetch");
      },
    });
    expect(r.queued).toBe(true);
    expect((await queue.list())[0].id).toBe("k2");
  });

  it("does not queue server-returned errors", async () => {
    const { queue } = setup();
    const r = await submitOrQueue({ ...base, queue, isOnline: () => true, run: async () => ({ error: "Invalid" }) });
    expect(r).toEqual({ error: "Invalid" });
    expect(await queue.list()).toEqual([]);
  });

  it("rethrows non-network errors", async () => {
    const { queue } = setup();
    await expect(
      submitOrQueue({ ...base, queue, isOnline: () => true, run: async () => { throw new Error("boom"); } }),
    ).rejects.toThrow("boom");
    expect(await queue.list()).toEqual([]);
  });
});

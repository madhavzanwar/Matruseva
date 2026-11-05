import { GnaniError } from "./errors";

/**
 * API-key pool with per-key concurrency 1 (some Gnani accounts allow only ONE
 * active request), a FIFO wait queue, retries with backoff and a circuit
 * breaker. Usage: `pool.run(({ key }) => doRequest(key))` where the callback
 * throws GnaniError on failure.
 *
 * Semantics
 *  - at most 1 in-flight call per key; callers queue FIFO (max wait `maxWaitMs`,
 *    queue cap `maxQueue`; both reject with kind rate_limited, code QUEUE_*).
 *  - 429: retry after backoff (500ms, 1s, 2s), preferring a different key.
 *  - timeout/upstream/network: same retry schedule.
 *  - 401/403: that key is disabled for `authCooldownMs` (10 min); the call is
 *    retried immediately on another key. All keys disabled => fail fast (auth).
 *  - 402: ALL keys marked credit-exhausted for `creditCooldownMs` (5 min);
 *    fail fast (kind credit), including queued waiters. Recovers by itself.
 *  - other errors are not retried.
 *  - `deadlineMs` bounds total time; no retry is started that would exceed it.
 *
 * State is module/instance-level memory: on serverless each instance has its
 * own pool, so the 1-per-key guarantee is per instance and a 429 from another
 * instance is handled by the retry path.
 */

export interface PoolOptions {
  keys: string[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  maxQueue?: number;
  authCooldownMs?: number;
  creditCooldownMs?: number;
  retryDelaysMs?: number[];
}

export interface RunContext {
  key: string;
  /** Index of the key in the pool (safe to log; the key itself is not). */
  keyIndex: number;
  attempt: number;
}

export interface RunOptions {
  /** Max total ms for all attempts (queue wait excluded from retry decisions only via now()). */
  deadlineMs?: number;
}

export interface PoolStatus {
  keyCount: number;
  availableKeys: number;
  circuitOpen: boolean;
  creditExhausted: boolean;
  queueLength: number;
}

interface KeyState {
  key: string;
  busy: boolean;
  disabledUntil: number;
  avoidUntil: number;
  lastUsed: number;
}

interface Waiter {
  resolve: (idx: number) => void;
  reject: (e: GnaniError) => void;
  timer: ReturnType<typeof setTimeout>;
  skip: Set<number>;
}

export class KeyPool {
  private readonly keys: KeyState[];
  private readonly queue: Waiter[] = [];
  private creditUntil = 0;
  private tick = 0;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxWaitMs: number;
  private readonly maxQueue: number;
  private readonly authCooldownMs: number;
  private readonly creditCooldownMs: number;
  private readonly retryDelaysMs: number[];

  constructor(opts: PoolOptions) {
    this.keys = opts.keys.map((key) => ({ key, busy: false, disabledUntil: 0, avoidUntil: 0, lastUsed: 0 }));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxWaitMs = opts.maxWaitMs ?? 20_000;
    this.maxQueue = opts.maxQueue ?? 25;
    this.authCooldownMs = opts.authCooldownMs ?? 10 * 60_000;
    this.creditCooldownMs = opts.creditCooldownMs ?? 5 * 60_000;
    this.retryDelaysMs = opts.retryDelaysMs ?? [500, 1000, 2000];
  }

  getStatus(): PoolStatus {
    const now = this.now();
    const creditExhausted = now < this.creditUntil;
    const usable = this.keys.filter((k) => now >= k.disabledUntil).length;
    return {
      keyCount: this.keys.length,
      availableKeys: creditExhausted ? 0 : usable,
      circuitOpen: creditExhausted || usable === 0,
      creditExhausted,
      queueLength: this.queue.length,
    };
  }

  /** Throws if the pool cannot serve right now (no keys / credit / all disabled). */
  private assertUsable(): void {
    const now = this.now();
    if (this.keys.length === 0) throw new GnaniError({ kind: "not_configured", code: "NO_KEYS" });
    if (now < this.creditUntil) throw new GnaniError({ kind: "credit", code: "CREDIT_EXHAUSTED", status: 402 });
    if (this.keys.every((k) => now < k.disabledUntil)) {
      throw new GnaniError({ kind: "auth", code: "ALL_KEYS_DISABLED" });
    }
  }

  private pickFree(skip: Set<number>): number {
    const now = this.now();
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.keys.length; i++) {
      const k = this.keys[i];
      if (k.busy || now < k.disabledUntil) continue;
      // Prefer keys not just rate-limited / already tried, then least recently used.
      const penalty = (now < k.avoidUntil ? 2 : 0) + (skip.has(i) ? 1 : 0);
      const score = penalty * 1e12 + k.lastUsed;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private acquire(skip: Set<number>): Promise<number> {
    this.assertUsable();
    // Only jump the queue if nobody is waiting (FIFO fairness).
    if (this.queue.length === 0) {
      const i = this.pickFree(skip);
      if (i >= 0) {
        this.keys[i].busy = true;
        this.keys[i].lastUsed = ++this.tick;
        return Promise.resolve(i);
      }
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new GnaniError({ kind: "rate_limited", code: "QUEUE_FULL" }));
    }
    return new Promise<number>((resolve, reject) => {
      const w: Waiter = {
        resolve,
        reject,
        skip,
        timer: setTimeout(() => {
          const idx = this.queue.indexOf(w);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new GnaniError({ kind: "rate_limited", code: "QUEUE_TIMEOUT" }));
        }, this.maxWaitMs),
      };
      this.queue.push(w);
    });
  }

  private release(i: number): void {
    this.keys[i].busy = false;
    this.drain();
  }

  /** Hand free keys to waiters in FIFO order; fail waiters if the pool became unusable. */
  private drain(): void {
    while (this.queue.length > 0) {
      try {
        this.assertUsable();
      } catch (e) {
        for (const w of this.queue.splice(0)) {
          clearTimeout(w.timer);
          w.reject(e as GnaniError);
        }
        return;
      }
      const i = this.pickFree(this.queue[0].skip);
      if (i < 0) return;
      const w = this.queue.shift()!;
      clearTimeout(w.timer);
      this.keys[i].busy = true;
      this.keys[i].lastUsed = ++this.tick;
      w.resolve(i);
    }
  }

  async run<T>(fn: (ctx: RunContext) => Promise<T>, opts: RunOptions = {}): Promise<T> {
    const start = this.now();
    const tried = new Set<number>();
    const maxAttempts = this.retryDelaysMs.length + 1;
    let backoffs = 0;
    let lastErr: GnaniError | undefined;

    for (let attempt = 1; attempt <= maxAttempts + this.keys.length; attempt++) {
      const idx = await this.acquire(tried);
      let result: T;
      try {
        result = await fn({ key: this.keys[idx].key, keyIndex: idx, attempt });
        this.release(idx);
        return result;
      } catch (e) {
        const err = e instanceof GnaniError ? e : new GnaniError({ kind: "network", message: "unexpected error" });
        lastErr = err;
        tried.add(idx);
        const now = this.now();
        if (err.kind === "credit") {
          this.creditUntil = now + this.creditCooldownMs;
          this.keys[idx].busy = false;
          this.drain();
          throw err;
        }
        if (err.kind === "auth" || err.kind === "forbidden") {
          this.keys[idx].disabledUntil = now + this.authCooldownMs;
          this.release(idx);
          // Try another key straight away if one remains; otherwise acquire() fails fast.
          continue;
        }
        if (err.kind === "rate_limited") this.keys[idx].avoidUntil = now + (this.retryDelaysMs[backoffs] ?? 2000);
        this.release(idx);
        if (!err.retryable || backoffs >= this.retryDelaysMs.length) throw err;
        const delay = this.retryDelaysMs[backoffs++];
        if (opts.deadlineMs !== undefined && this.now() + delay - start >= opts.deadlineMs) throw err;
        await this.sleep(delay);
      }
    }
    throw lastErr ?? new GnaniError({ kind: "upstream" });
  }
}

// ---- process-wide singleton, rebuilt when the key set changes -------------

let shared: { sig: string; pool: KeyPool } | undefined;

export function getSharedPool(keys: string[]): KeyPool {
  const sig = keys.join("\u0000");
  if (!shared || shared.sig !== sig) shared = { sig, pool: new KeyPool({ keys }) };
  return shared.pool;
}

/** Test helper. */
export function resetSharedPool(): void {
  shared = undefined;
}

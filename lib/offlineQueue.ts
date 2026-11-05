/**
 * Offline write queue for the two highest-value clinic writes: recording a
 * visit and logging a contact. Entries live in the browser's IndexedDB (this is
 * patient health data — see docs/SECURITY.md "Offline queue") and are replayed
 * by components/OfflineSync.tsx when the connection returns.
 *
 * Everything here is storage-agnostic: the queue takes a `QueueStorage`, with an
 * IndexedDB implementation for the browser and an in-memory one for tests.
 * Replays are idempotent server-side via `client_request_id` (= entry id).
 */
import { offlineT } from "./offlineI18n";

export type QueueEntryType = "visit" | "contact";
export type QueueEntryStatus = "pending" | "failed";

/** Only plain string form values are queued; the action needs nothing else. */
export type QueuePayload = Record<string, string>;

export interface QueueEntry {
  /** UUID; also sent to the server as the idempotency key (client_request_id). */
  id: string;
  type: QueueEntryType;
  patientId: string;
  /** Signed-in user who queued this; entries are only replayed for the same user. */
  userId: string | null;
  payload: QueuePayload;
  createdAt: number;
  attempts: number;
  lastError: string | null;
  status: QueueEntryStatus;
  /** Earliest time (ms epoch) the next replay may run (exponential backoff). */
  nextAttemptAt: number;
}

export interface QueueStorage {
  getAll(): Promise<QueueEntry[]>;
  put(entry: QueueEntry): Promise<void>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Whitelisted payload keys per type: nothing else is ever stored. */
export const PAYLOAD_KEYS: Record<QueueEntryType, readonly string[]> = {
  visit: ["visitDate", "bpSys", "bpDia", "weight", "hb", "fhr", "fundalHeight", "notes", "nextVisitDate"],
  // `source` picks the action on replay: "form" -> logContact, "quick" -> quickLogContact.
  contact: ["channel", "outcome", "reason", "notes", "source"],
};

export function pickPayload(type: QueueEntryType, source: Record<string, unknown>): QueuePayload {
  const out: QueuePayload = {};
  for (const key of PAYLOAD_KEYS[type]) {
    const v = source[key];
    if (typeof v === "string" && v !== "") out[key] = v;
  }
  return out;
}

// ---------------------------------------------------------------- storage

export function createMemoryStorage(): QueueStorage {
  const map = new Map<string, QueueEntry>();
  return {
    async getAll() {
      return [...map.values()].map((e) => ({ ...e, payload: { ...e.payload } }));
    },
    async put(entry) {
      map.set(entry.id, { ...entry, payload: { ...entry.payload } });
    },
    async delete(id) {
      map.delete(id);
    },
    async clear() {
      map.clear();
    },
  };
}

const DB_NAME = "matrusetu-offline";
const STORE = "queue";

export function createIndexedDbStorage(): QueueStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        dbPromise = null;
        reject(req.error ?? new Error("IndexedDB unavailable"));
      };
    });
    return dbPromise;
  };
  async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result);
      t.onerror = () => reject(t.error ?? new Error("IndexedDB error"));
      t.onabort = () => reject(t.error ?? new Error("IndexedDB aborted"));
    });
  }
  return {
    getAll: () => tx("readonly", (s) => s.getAll() as IDBRequest<QueueEntry[]>),
    put: async (entry) => void (await tx("readwrite", (s) => s.put(entry))),
    delete: async (id) => void (await tx("readwrite", (s) => s.delete(id))),
    clear: async () => void (await tx("readwrite", (s) => s.clear())),
  };
}

// ----------------------------------------------------------- pure helpers

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
/** After this many failed replays of a transient error the entry is parked as failed. */
export const MAX_ATTEMPTS = 10;

/** Delay before replay number `attempts + 1`: 5s, 10s, 20s ... capped at 5 min. */
export function backoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_MAX_MS);
}

export type ErrorClass = "network" | "transient" | "permanent";

const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network request failed|load failed|network connection was lost|econnrefused|econnreset|enotfound|etimedout|offline/i;
const TRANSIENT_RE = /connection|timed? ?out|timeout|temporarily|unavailable|too many requests|server components render|\b50[0-4]\b/i;

/** True when a thrown value looks like "the request never got a response". */
export function isNetworkError(err: unknown): boolean {
  // fetch() rejects with a TypeError whose message is browser-specific
  // ("Failed to fetch", "Load failed", "NetworkError when attempting..."); a bare
  // TypeError from a code bug must not be mistaken for a network drop.
  if (typeof navigator !== "undefined" && navigator.onLine === false && err instanceof TypeError) return true;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return NETWORK_RE.test(msg);
}

/**
 * Classify the outcome of a replay.
 *  - network:   thrown, no response -> stop the flush, keep entry pending, back off
 *  - transient: server reachable but temporarily failing -> back off, keep pending (bounded)
 *  - permanent: the action returned a validation/auth/RLS error -> mark failed, show it
 */
export function classifyError(err: unknown): ErrorClass {
  if (typeof err === "string") return TRANSIENT_RE.test(err) || NETWORK_RE.test(err) ? "transient" : "permanent";
  if (isNetworkError(err)) return "network";
  // Any other thrown error (e.g. a 500 from the server action endpoint).
  return "transient";
}

/** Pending entries, oldest first (FIFO overall, hence FIFO per patient). */
export function fifo(entries: QueueEntry[]): QueueEntry[] {
  return [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function pendingEntries(entries: QueueEntry[]): QueueEntry[] {
  return fifo(entries.filter((e) => e.status === "pending"));
}

/** Entries whose backoff has elapsed. */
export function dueEntries(entries: QueueEntry[], now: number): QueueEntry[] {
  return pendingEntries(entries).filter((e) => e.nextAttemptAt <= now);
}

/** Earliest future retry time among pending entries, or null. */
export function nextRetryAt(entries: QueueEntry[]): number | null {
  const times = pendingEntries(entries).map((e) => e.nextAttemptAt);
  return times.length ? Math.min(...times) : null;
}

// ------------------------------------------------------------------ queue

export interface QueueDeps {
  now?: () => number;
  uuid?: () => string;
}

export interface OfflineQueue {
  enqueue(input: { id?: string; type: QueueEntryType; patientId: string; payload: QueuePayload }): Promise<QueueEntry>;
  list(): Promise<QueueEntry[]>;
  remove(id: string): Promise<void>;
  /** Park an entry as failed (permanent error); it is never retried automatically. */
  markFailed(id: string, message: string): Promise<void>;
  /** Record a failed replay that should be retried later (backoff applied). */
  markRetryLater(id: string, message: string): Promise<void>;
  /** Manual retry of a failed entry: back to pending, attempts reset. */
  retry(id: string): Promise<void>;
  clear(): Promise<void>;
}

let currentUserId: string | null = null;

/** Set by OfflineSync so entries queued from anywhere in the app are tagged with the signed-in user. */
export function setOfflineUserId(id: string | null) {
  currentUserId = id;
}

export function createQueue(storage: QueueStorage, deps: QueueDeps = {}): OfflineQueue {
  const now = deps.now ?? Date.now;
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  async function update(id: string, fn: (e: QueueEntry) => QueueEntry) {
    const all = await storage.getAll();
    const found = all.find((e) => e.id === id);
    if (found) await storage.put(fn(found));
  }

  return {
    async enqueue({ id, type, patientId, payload }) {
      const all = await storage.getAll();
      const existing = id ? all.find((e) => e.id === id) : undefined;
      if (existing) return existing; // same idempotency key: already queued
      const maxCreated = all.reduce((m, e) => Math.max(m, e.createdAt), 0);
      const entry: QueueEntry = {
        id: id ?? uuid(),
        type,
        patientId,
        userId: currentUserId,
        payload: pickPayload(type, payload),
        // strictly increasing so FIFO is stable even within the same millisecond
        createdAt: Math.max(now(), maxCreated + 1),
        attempts: 0,
        lastError: null,
        status: "pending",
        nextAttemptAt: 0,
      };
      await storage.put(entry);
      return entry;
    },
    async list() {
      return fifo(await storage.getAll());
    },
    remove: (id) => storage.delete(id),
    markFailed: (id, message) => update(id, (e) => ({ ...e, status: "failed", lastError: message, attempts: e.attempts + 1 })),
    markRetryLater: (id, message) =>
      update(id, (e) => {
        const attempts = e.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) return { ...e, attempts, status: "failed", lastError: message };
        return { ...e, attempts, lastError: message, nextAttemptAt: now() + backoffMs(attempts) };
      }),
    retry: (id) => update(id, (e) => ({ ...e, status: "pending", attempts: 0, nextAttemptAt: 0 })),
    clear: () => storage.clear(),
  };
}

// ------------------------------------------------------------------ flush

export interface ActionOutcome {
  error: string | null;
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** True when the flush stopped early because of a network/transient error. */
  stopped: boolean;
}

/**
 * Replay due entries FIFO. `send` performs the real server action; a thrown
 * network error (or transient failure) stops the flush so ordering is kept; a
 * permanent error parks that single entry as failed and continues.
 */
export async function flushQueue(
  queue: OfflineQueue,
  send: (entry: QueueEntry) => Promise<ActionOutcome>,
  opts: { now?: () => number; isOnline?: () => boolean; userId?: string } = {},
): Promise<FlushResult> {
  const now = opts.now ?? Date.now;
  const result: FlushResult = { sent: 0, failed: 0, stopped: false };
  const all = await queue.list();
  if (opts.userId !== undefined) {
    // Never replay another user's (or untagged legacy) writes under this session: drop them.
    for (const e of all) if (e.userId !== opts.userId) await queue.remove(e.id);
  }
  for (const entry of pendingEntries(all)) {
    if (opts.userId !== undefined && entry.userId !== opts.userId) continue;
    // An older entry still backing off blocks everything behind it (FIFO).
    if (entry.nextAttemptAt > now()) {
      result.stopped = true;
      break;
    }
    if (opts.isOnline && !opts.isOnline()) {
      result.stopped = true;
      break;
    }
    let outcome: ActionOutcome;
    try {
      outcome = await send(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : offlineT("shell.offline.syncError");
      await queue.markRetryLater(entry.id, message);
      result.stopped = true;
      break;
    }
    if (!outcome.error) {
      await queue.remove(entry.id);
      result.sent++;
      continue;
    }
    if (classifyError(outcome.error) === "permanent") {
      await queue.markFailed(entry.id, outcome.error);
      result.failed++;
      continue;
    }
    await queue.markRetryLater(entry.id, outcome.error);
    result.stopped = true;
    break;
  }
  return result;
}

// -------------------------------------------------------- browser singleton

const CHANGE_EVENT = "matrusetu:offline-queue";
let singleton: OfflineQueue | null = null;

function notifyChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Subscribe to queue changes made in this tab. Returns an unsubscribe fn. */
export function onQueueChange(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => window.removeEventListener(CHANGE_EVENT, cb);
}

/** The shared IndexedDB-backed queue (browser only). Emits a change event after each mutation. */
export function getOfflineQueue(): OfflineQueue {
  if (singleton) return singleton;
  const inner = createQueue(createIndexedDbStorage());
  const wrap =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      const r = await fn(...a);
      notifyChange();
      return r;
    };
  singleton = {
    enqueue: wrap(inner.enqueue),
    list: inner.list,
    remove: wrap(inner.remove),
    markFailed: wrap(inner.markFailed),
    markRetryLater: wrap(inner.markRetryLater),
    retry: wrap(inner.retry),
    clear: wrap(inner.clear),
  };
  return singleton;
}

/**
 * Called before sign-out. If unsynced changes exist, asks for confirmation and
 * wipes the queue (it holds patient data and must not outlive the session).
 * Returns false when the user cancels.
 */
export async function discardQueueForLogout(): Promise<boolean> {
  try {
    if (typeof indexedDB === "undefined") return true;
    const q = getOfflineQueue();
    const n = (await q.list()).length;
    if (n > 0) {
      const ok = window.confirm(offlineT("shell.offline.logoutConfirm", { count: n }));
      if (!ok) return false;
    }
    await q.clear();
  } catch {
    // Storage unavailable: nothing to protect or clear.
  }
  return true;
}

"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise, CloudSlash, WarningCircle } from "@phosphor-icons/react";
import { recordVisit } from "@/app/(app)/patients/[id]/actions";
import { logContact, quickLogContact } from "@/app/(app)/calls/actions";
import { showToast } from "@/components/Toaster";
import { useLocale, useT } from "@/lib/i18n/provider";
import { intlLocale } from "@/lib/i18n/intl";
import { setOfflineTranslator } from "@/lib/offlineI18n";
import {
  flushQueue,
  getOfflineQueue,
  nextRetryAt,
  onQueueChange,
  setOfflineUserId,
  type ActionOutcome,
  type QueueEntry,
} from "@/lib/offlineQueue";

const LOCK_NAME = "matrusetu-offline-flush";

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

/** Replays one queued entry through the same server action the form would have used. */
async function send(entry: QueueEntry): Promise<ActionOutcome> {
  const p = entry.payload;
  if (entry.type === "visit") {
    const fd = new FormData();
    for (const [k, v] of Object.entries(p)) fd.set(k, v);
    fd.set("clientRequestId", entry.id);
    return recordVisit(entry.patientId, { error: null }, fd);
  }
  if (p.source === "quick") {
    return quickLogContact(
      entry.patientId,
      p.channel === "whatsapp" ? "whatsapp" : "call",
      p.outcome as Parameters<typeof quickLogContact>[2],
      p.notes,
      entry.id,
    );
  }
  const fd = new FormData();
  for (const [k, v] of Object.entries(p)) if (k !== "source") fd.set(k, v);
  fd.set("clientRequestId", entry.id);
  return logContact(entry.patientId, { error: null }, fd);
}

// In-memory guard for browsers without navigator.locks (the lock also covers other tabs).
let flushing = false;

async function runExclusive(fn: () => Promise<void>) {
  if (flushing) return;
  flushing = true;
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (lock) await fn();
      });
    } else {
      await fn();
    }
  } finally {
    flushing = false;
  }
}

/**
 * Replays queued offline writes (visits and contact logs) and shows a small
 * status pill. Mounted once from the (app) layout.
 */
export function OfflineSync({ userId }: { userId: string }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const online = useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    try {
      setEntries(await getOfflineQueue().list());
    } catch {
      setEntries([]); // IndexedDB unavailable: nothing is queued
    }
  }, []);

  // Lets non-React code (offline queue, submit helpers) translate its messages.
  useEffect(() => {
    setOfflineTranslator(t);
  }, [t]);

  useEffect(() => {
    setOfflineUserId(userId);
  }, [userId]);

  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    let sent = 0;
    let retryAt: number | null = null;
    await runExclusive(async () => {
      const queue = getOfflineQueue();
      if ((await queue.list()).every((e) => e.status !== "pending")) return;
      setSyncing(true);
      try {
        const res = await flushQueue(queue, send, { isOnline: () => navigator.onLine, userId });
        sent = res.sent;
        retryAt = nextRetryAt(await queue.list());
      } finally {
        setSyncing(false);
      }
    });
    await refresh();
    if (sent > 0) {
      showToast(t("shell.offline.synced", { count: sent }));
      router.refresh();
    }
    // Exponential backoff: wake up when the earliest pending entry is due again.
    if (timer.current) clearTimeout(timer.current);
    if (retryAt !== null) {
      timer.current = setTimeout(() => void flushRef.current(), Math.max(1_000, retryAt - Date.now()));
    }
  }, [refresh, router, t, userId]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const run = () => void flushRef.current();
    const onVisible = () => document.visibilityState === "visible" && run();
    run(); // app load
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    const off = onQueueChange(() => void refresh());
    return () => {
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
      off();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const pending = entries.filter((e) => e.status === "pending");
  const failed = entries.filter((e) => e.status === "failed");

  // Queued while online (e.g. the server was unreachable): try again soon.
  const hasPending = pending.length > 0;
  useEffect(() => {
    if (hasPending && online) void flushRef.current();
  }, [hasPending, online]);

  if (online && !syncing && entries.length === 0) return null;

  const text = syncing
    ? t("shell.offline.syncing")
    : pending.length > 0
      ? t(online ? "shell.offline.waiting" : "shell.offline.offlineWaiting", { count: pending.length })
      : !online
        ? t("shell.offline.offline")
        : null;

  return (
    <div className="fixed bottom-28 left-3 z-[55] md:left-[calc(var(--sb-w,0rem)+1rem)] flex max-w-[calc(100vw-1.5rem)] flex-col items-start gap-2 md:bottom-4">
      {open && failed.length > 0 && (
        <div className="w-80 max-w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-[13px] shadow-lg">
          <p className="mb-2 font-semibold text-[var(--color-foreground)]">{t("shell.offline.failedTitle")}</p>
          <ul className="space-y-2">
            {failed.map((e) => (
              <li key={e.id} className="rounded-lg bg-[var(--color-surface-1)] p-2">
                <p className="font-medium text-[var(--color-foreground)]">
                  {t(e.type === "visit" ? "shell.offline.kind.visit" : "shell.offline.kind.contact")} ·{" "}
                  {new Date(e.createdAt).toLocaleString(intlLocale(locale))}
                </p>
                <p className="mt-0.5 break-words text-[var(--color-overdue)]">{e.lastError ?? t("shell.offline.unknownError")}</p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    className="min-h-9 rounded-lg bg-[var(--color-primary)] px-3 font-semibold text-white"
                    onClick={async () => {
                      await getOfflineQueue().retry(e.id);
                      void flushRef.current();
                    }}
                  >
                    {t("shell.offline.retry")}
                  </button>
                  <button
                    type="button"
                    className="min-h-9 rounded-lg border border-[var(--color-border-strong)] px-3 font-semibold text-[var(--color-foreground)]"
                    onClick={() => void getOfflineQueue().remove(e.id)}
                  >
                    {t("common.discard")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-full bg-[var(--color-pc-ink)] py-1.5 pl-3 pr-2 text-[12px] font-medium text-white shadow-md"
      >
        {syncing ? (
          <ArrowsClockwise size={14} className="animate-spin" aria-hidden />
        ) : (
          <CloudSlash size={14} aria-hidden />
        )}
        {text && <span>{text}</span>}
        {failed.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-7 items-center gap-1 rounded-full bg-white/15 px-2 hover:bg-white/25"
          >
            <WarningCircle size={14} aria-hidden />
            {t("shell.offline.failedCount", { count: failed.length })}
          </button>
        )}
      </div>
    </div>
  );
}

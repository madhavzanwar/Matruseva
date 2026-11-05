"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Playlist player for the server-synthesised counselling audio (Gnani Timbre mp3 parts).
 *
 *  - Asks the server for a manifest ({ parts }) on mount / language change. Any failure
 *    (not configured, out of credit, offline, 5xx, bad JSON) => engine "browser": the caller then
 *    uses its existing speechSynthesis implementation.
 *  - Plays the parts back-to-back with ONE <audio> element (auto-advance, prefetch of the next
 *    part, previous/next, seek across parts, playbackRate). Playback only ever starts from a
 *    user gesture (toggle/next/prev/seek are called from click handlers): never autoplay (iOS/Android).
 *  - A part that keeps failing => engine "browser" with reason "error" (a notice is shown). It does NOT
 *    start the browser voice by itself: speechSynthesis also needs a gesture, so the user taps play again.
 */

export type CounselEngine = "checking" | "gnani" | "browser";
export type CounselPhase = "idle" | "loading" | "playing" | "paused";

interface Options {
  /** Base URL of the manifest/part route (may already contain a query string). null => browser voice only. */
  endpoint: string | null;
  /** Counselling language (sent as `lang`; the public route ignores it and uses the token's). */
  lang: string;
  /** audio.playbackRate (0.85-1.15). */
  rate: number;
  /** false => do not use the server voice (e.g. the staff typed a note the server cannot know). */
  enabled?: boolean;
}

const withParams = (endpoint: string, params: Record<string, string>) => {
  const q = new URLSearchParams(params).toString();
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}${q}`;
};

export function useCounselAudio({ endpoint, lang, rate, enabled = true }: Options) {
  const usable = !!endpoint && enabled;
  const [engine, setEngine] = useState<CounselEngine>(usable ? "checking" : "browser");
  const [fellBack, setFellBack] = useState(false);
  const [parts, setParts] = useState(0);
  const [phase, setPhase] = useState<CounselPhase>("idle");
  const [partIndex, setPartIndex] = useState(0);
  const [fraction, setFraction] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const versionRef = useRef("");
  const partsRef = useRef(0);
  const indexRef = useRef(0);
  const rateRef = useRef(rate);
  const retriesRef = useRef(0);
  const switchingRef = useRef(false);
  const prefetchedRef = useRef(new Set<string>());
  const pendingSeekRef = useRef<number | null>(null);
  const endpointRef = useRef(endpoint);
  const langRef = useRef(lang);

  useEffect(() => {
    endpointRef.current = endpoint;
    langRef.current = lang;
  }, [endpoint, lang]);

  const partUrl = useCallback((i: number) => {
    return withParams(endpointRef.current ?? "", { lang: langRef.current, part: String(i), v: versionRef.current });
  }, []);

  const release = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    switchingRef.current = true;
    a.pause();
    a.removeAttribute("src");
    a.load();
    switchingRef.current = false;
  }, []);

  const resetPlayback = useCallback(() => {
    release();
    indexRef.current = 0;
    retriesRef.current = 0;
    pendingSeekRef.current = null;
    setPartIndex(0);
    setFraction(0);
    setPhase("idle");
  }, [release]);

  const giveUp = useCallback(() => {
    resetPlayback();
    setFellBack(true);
    setEngine("browser");
  }, [resetPlayback]);

  const prefetch = useCallback(
    (i: number) => {
      if (i < 0 || i >= partsRef.current) return;
      const url = partUrl(i);
      if (prefetchedRef.current.has(url)) return;
      prefetchedRef.current.add(url);
      // Warms the server cache (and the HTTP cache: parts are immutable per version) while the current part plays.
      fetch(url, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.arrayBuffer() : undefined))
        .catch(() => undefined);
    },
    [partUrl],
  );

  const playCurrent = useCallback(
    (a: HTMLAudioElement) => {
      a.play().catch((e: unknown) => {
        const name = (e as { name?: string })?.name;
        if (name === "AbortError") return; // superseded by a newer load
        if (name === "NotAllowedError") {
          setPhase("paused"); // needs a tap (a retry outside a gesture); the user taps play
          return;
        }
        giveUp();
      });
    },
    [giveUp],
  );

  const loadPart = useCallback(
    (a: HTMLAudioElement, i: number) => {
      switchingRef.current = true;
      indexRef.current = i;
      retriesRef.current = 0;
      a.src = partUrl(i);
      a.defaultPlaybackRate = rateRef.current;
      a.playbackRate = rateRef.current;
      switchingRef.current = false;
      setPartIndex(i);
      setFraction(0);
      setPhase("loading");
      playCurrent(a);
    },
    [partUrl, playCurrent],
  );

  const ensureAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const a = new Audio();
    a.preload = "auto";
    audioRef.current = a;
    a.addEventListener("playing", () => {
      setPhase("playing");
      retriesRef.current = 0;
      prefetch(indexRef.current + 1);
    });
    a.addEventListener("waiting", () => {
      if (!a.paused) setPhase("loading");
    });
    a.addEventListener("pause", () => {
      if (switchingRef.current || a.ended) return;
      setPhase((p) => (p === "idle" ? p : "paused"));
    });
    a.addEventListener("timeupdate", () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setFraction(Math.min(1, a.currentTime / a.duration));
    });
    a.addEventListener("loadedmetadata", () => {
      if (pendingSeekRef.current !== null && Number.isFinite(a.duration)) {
        a.currentTime = pendingSeekRef.current * a.duration;
        pendingSeekRef.current = null;
      }
    });
    a.addEventListener("ended", () => {
      const next = indexRef.current + 1;
      if (next < partsRef.current) {
        loadPart(a, next);
      } else {
        indexRef.current = 0;
        setPartIndex(0);
        setFraction(0);
        setPhase("idle");
      }
    });
    a.addEventListener("error", () => {
      if (switchingRef.current || !a.getAttribute("src")) return; // our own release()
      if (retriesRef.current < 1) {
        retriesRef.current += 1;
        a.load();
        playCurrent(a);
        return;
      }
      giveUp();
    });
    return a;
  }, [giveUp, loadPart, playCurrent, prefetch]);

  // New endpoint / language / enabled => forget the old session (state adjusted during render, not in an effect).
  const sessionKey = `${usable ? 1 : 0}|${endpoint ?? ""}|${lang}`;
  const [prevSessionKey, setPrevSessionKey] = useState(sessionKey);
  if (prevSessionKey !== sessionKey) {
    setPrevSessionKey(sessionKey);
    setEngine(usable ? "checking" : "browser");
    setFellBack(false);
    setParts(0);
    setPhase("idle");
    setPartIndex(0);
    setFraction(0);
  }

  // Manifest on mount / language change.
  useEffect(() => {
    release();
    indexRef.current = 0;
    retriesRef.current = 0;
    pendingSeekRef.current = null;
    if (!endpoint || !enabled) return;
    const ctrl = new AbortController();
    fetch(withParams(endpoint, { lang }), { signal: ctrl.signal, credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { ok?: boolean; parts?: number; version?: string } | null;
        if (r.ok && j?.ok === true && Number.isInteger(j.parts) && (j.parts as number) > 0 && (j.parts as number) <= 999) {
          versionRef.current = typeof j.version === "string" ? j.version : "";
          partsRef.current = j.parts as number;
          prefetchedRef.current.clear();
          setParts(j.parts as number);
          setEngine("gnani");
        } else {
          setEngine("browser"); // not configured / unavailable / limited: quietly use the browser voice
        }
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== "AbortError") setEngine("browser");
      });
    return () => ctrl.abort();
  }, [endpoint, lang, enabled, release]);

  useEffect(() => {
    rateRef.current = rate;
    const a = audioRef.current;
    if (a) {
      a.defaultPlaybackRate = rate;
      a.playbackRate = rate;
    }
  }, [rate]);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a) {
        switchingRef.current = true;
        a.pause();
        a.removeAttribute("src");
        a.load();
      }
    };
  }, []);

  const toggle = useCallback(() => {
    const a = ensureAudio();
    if (phase === "playing" || phase === "loading") {
      a.pause();
      setPhase("paused");
    } else if (phase === "paused" && a.getAttribute("src")) {
      setPhase("loading");
      playCurrent(a);
    } else {
      loadPart(a, indexRef.current >= partsRef.current ? 0 : indexRef.current);
    }
  }, [ensureAudio, loadPart, phase, playCurrent]);

  const stop = useCallback(() => resetPlayback(), [resetPlayback]);

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= partsRef.current) return;
      loadPart(ensureAudio(), i);
    },
    [ensureAudio, loadPart],
  );
  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => {
    const a = audioRef.current;
    // Like a media player: a few seconds in => restart this part, otherwise go to the previous one.
    if (a && a.getAttribute("src") && a.currentTime > 3) {
      a.currentTime = 0;
      return;
    }
    goTo(indexRef.current - 1);
  }, [goTo]);

  /** Seek to a position 0..1 across the whole playlist. */
  const seek = useCallback(
    (f: number) => {
      const total = partsRef.current;
      if (total < 1 || !Number.isFinite(f)) return;
      const pos = Math.min(Math.max(f, 0), 0.9999) * total;
      const target = Math.floor(pos);
      const within = pos - target;
      const a = ensureAudio();
      if (target === indexRef.current && a.getAttribute("src") && Number.isFinite(a.duration) && a.duration > 0) {
        a.currentTime = within * a.duration;
        setFraction(within);
        return;
      }
      pendingSeekRef.current = within > 0.001 ? within : null;
      loadPart(a, target);
    },
    [ensureAudio, loadPart],
  );

  return {
    engine,
    /** true once the server voice failed mid-session (show a notice). */
    fellBack,
    parts,
    phase,
    partIndex,
    /** 0..1 across all parts. */
    progress: parts > 0 ? (partIndex + fraction) / parts : 0,
    toggle,
    stop,
    next,
    prev,
    seek,
  };
}

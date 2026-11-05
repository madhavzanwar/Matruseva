// Client-only microphone recorder (getUserMedia + MediaRecorder).
//
// SEGMENTING DESIGN (simple + robust): Gnani STT accepts at most 30 s per request,
// so a recording auto-stops at MAX_SEGMENT_MS (28 s) and fires `onLimit`. The UI then
// converts + uploads that segment and the clinician presses "start" again to continue;
// the new segment's transcript is appended and the tail of the transcript so far
// (<= 600 chars) is sent as `previous_text`. We deliberately do NOT roll recorders
// while recording: swapping MediaRecorder instances drops audio at the seam, which for
// numbers ("130 / 80") is worse than an explicit pause.

export const MAX_SEGMENT_MS = 28_000;

export type RecorderErrorCode = "permission_denied" | "no_microphone" | "unsupported" | "failed";

export class RecorderError extends Error {
  readonly code: RecorderErrorCode;
  constructor(code: RecorderErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RecorderError";
    this.code = code;
  }
}

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

/** Best MediaRecorder mime this browser supports ("" = let the browser pick). */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

/** True when this browser can capture audio at all. */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface RecordingResult {
  blob: Blob;
  durationMs: number;
  /** True when the recording ended because MAX_SEGMENT_MS was reached. */
  hitLimit: boolean;
}

export interface ActiveRecording {
  /** Stop and resolve with the audio. Safe to call after an auto-stop (returns the same result). */
  stop(): Promise<RecordingResult>;
  /** Stop, release the microphone and discard the audio. */
  cancel(): void;
}

export interface StartOptions {
  maxMs?: number;
  /** RMS level 0..1, ~15 times a second. */
  onLevel?: (level: number) => void;
  /** Fired once when the segment cap stops the recording. Call stop() to collect the audio. */
  onLimit?: () => void;
}

export async function startRecording(opts: StartOptions = {}): Promise<ActiveRecording> {
  if (!isRecordingSupported()) throw new RecorderError("unsupported");
  const maxMs = opts.maxMs ?? MAX_SEGMENT_MS;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "NotAllowedError" || name === "SecurityError") throw new RecorderError("permission_denied");
    if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") throw new RecorderError("no_microphone");
    throw new RecorderError("failed");
  }

  const mime = pickRecorderMime();
  let recorder: MediaRecorder;
  try {
    recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new RecorderError("unsupported");
  }

  // Level meter (optional; failures are ignored).
  let ctx: AudioContext | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  if (opts.onLevel) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) {
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        meterTimer = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
          opts.onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        }, 70);
      }
    } catch {
      /* no meter */
    }
  }

  const chunks: Blob[] = [];
  const startedAt = Date.now();
  let hitLimit = false;
  let cancelled = false;
  let limitTimer: ReturnType<typeof setTimeout> | null = null;

  const release = () => {
    if (limitTimer) clearTimeout(limitTimer);
    if (meterTimer) clearInterval(meterTimer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx?.close?.().catch(() => {});
    opts.onLevel?.(0);
  };

  const done = new Promise<RecordingResult>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = () => {
      release();
      reject(new RecorderError("failed"));
    };
    recorder.onstop = () => {
      release();
      if (cancelled) return reject(new RecorderError("failed", "cancelled"));
      resolve({
        blob: new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }),
        durationMs: Date.now() - startedAt,
        hitLimit,
      });
    };
  });
  done.catch(() => {}); // avoid unhandled rejection after cancel()

  try {
    recorder.start();
  } catch {
    release();
    throw new RecorderError("failed");
  }

  limitTimer = setTimeout(() => {
    if (recorder.state === "inactive") return;
    hitLimit = true;
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
    opts.onLimit?.();
  }, maxMs);

  return {
    stop() {
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      return done;
    },
    cancel() {
      cancelled = true;
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          release();
        }
      } else release();
    },
  };
}

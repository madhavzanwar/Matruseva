// Client-safe audio helpers: PCM16 WAV encoding, downmix and resampling.
// The pure functions have no browser dependency (unit-tested in node);
// blobToWav16k() needs Web Audio and throws AudioUnsupportedError otherwise.

export const TARGET_SAMPLE_RATE = 16000;

export class AudioUnsupportedError extends Error {
  readonly code = "audio_unsupported_browser" as const;
  constructor(message = "Audio decoding is not supported in this browser") {
    super(message);
    this.name = "AudioUnsupportedError";
  }
}

export class AudioDecodeError extends Error {
  readonly code = "audio_decode_failed" as const;
  constructor(message = "Could not decode the recording") {
    super(message);
    this.name = "AudioDecodeError";
  }
}

/** Encode mono float samples (-1..1, clipped) as a 16-bit PCM WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[off + i] = s.charCodeAt(i);
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i];
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(-1, Math.min(1, s));
    v.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

/** Average several channels into one. */
export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const len = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const c of channels) sum += c[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/** Linear-interpolation resampler (adequate for speech at 16 kHz). */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError("Invalid sample rate");
  if (fromRate === toRate || input.length === 0) return input;
  const outLen = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[Math.min(i0, input.length - 1)] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

/** Duration of a mono 16-bit PCM WAV produced by encodeWav, in seconds. */
export function wavDurationSeconds(wav: Uint8Array): number {
  if (wav.length < 44) return 0;
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const rate = v.getUint32(24, true);
  return rate > 0 ? (wav.length - 44) / 2 / rate : 0;
}

type AudioCtxCtor = typeof AudioContext;

/** Decode any browser-playable audio blob (WebM/Opus, MP4, ...) to 16 kHz mono PCM16 WAV. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const g = globalThis as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor || typeof blob.arrayBuffer !== "function") throw new AudioUnsupportedError();
  const ctx = new Ctor();
  try {
    const data = await blob.arrayBuffer();
    let decoded: AudioBuffer;
    try {
      // Callback form for old Safari; the promise form for everyone else.
      decoded = await new Promise<AudioBuffer>((resolve, reject) => {
        const p = ctx.decodeAudioData(data, resolve, reject);
        if (p && typeof p.then === "function") p.then(resolve, reject);
      });
    } catch {
      throw new AudioDecodeError();
    }
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    const mono = downmixToMono(channels);
    const samples = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const wav = encodeWav(samples, TARGET_SAMPLE_RATE);
    return new Blob([wav as BlobPart], { type: "audio/wav" });
  } finally {
    void ctx.close?.().catch(() => {});
  }
}

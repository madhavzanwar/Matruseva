import { describe, expect, it } from "vitest";
import { downmixToMono, encodeWav, resampleLinear, wavDurationSeconds, blobToWav16k, AudioUnsupportedError } from "./wav";

const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n));

describe("encodeWav", () => {
  it("writes a valid 44-byte PCM16 mono header", () => {
    const w = encodeWav(new Float32Array(160), 16000);
    const v = new DataView(w.buffer);
    expect(w.length).toBe(44 + 320);
    expect(ascii(w, 0, 4)).toBe("RIFF");
    expect(ascii(w, 8, 4)).toBe("WAVE");
    expect(ascii(w, 12, 4)).toBe("fmt ");
    expect(ascii(w, 36, 4)).toBe("data");
    expect(v.getUint32(4, true)).toBe(36 + 320);
    expect(v.getUint16(20, true)).toBe(1);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(28, true)).toBe(32000);
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(320);
    expect(wavDurationSeconds(w)).toBeCloseTo(0.01, 5);
  });
  it("clips out-of-range and sanitises non-finite samples", () => {
    const w = encodeWav(new Float32Array([2, -2, 0.5, NaN, 1, -1]), 16000);
    const v = new DataView(w.buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
    expect(v.getInt16(48, true)).toBe(16384);
    expect(v.getInt16(50, true)).toBe(0);
    expect(v.getInt16(52, true)).toBe(32767);
    expect(v.getInt16(54, true)).toBe(-32768);
  });
});

describe("resampleLinear / downmix", () => {
  it("scales length by the rate ratio", () => {
    expect(resampleLinear(new Float32Array(48000), 48000, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(44100), 44100, 16000).length).toBe(16000);
    expect(resampleLinear(new Float32Array(8000), 8000, 16000).length).toBe(16000);
  });
  it("returns the input when rates match and interpolates linearly", () => {
    const a = new Float32Array([0, 1]);
    expect(resampleLinear(a, 16000, 16000)).toBe(a);
    const up = resampleLinear(a, 8000, 16000);
    expect(Array.from(up)).toEqual([0, 0.5, 1, 1]);
  });
  it("rejects invalid rates", () => {
    expect(() => resampleLinear(new Float32Array(1), 0, 16000)).toThrow(RangeError);
  });
  it("downmixes by averaging", () => {
    const m = downmixToMono([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(m)).toEqual([0.5, 0.5]);
  });
});

describe("blobToWav16k", () => {
  it("throws a typed error without Web Audio", async () => {
    await expect(blobToWav16k(new Blob(["x"]))).rejects.toBeInstanceOf(AudioUnsupportedError);
  });
});

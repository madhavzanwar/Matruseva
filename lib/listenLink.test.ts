import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createListenToken, verifyListenToken, LISTEN_LINK_DEFAULT_TTL_SECONDS } from "./listenLink";

const PID = "11111111-2222-3333-4444-555555555555";

afterEach(() => vi.unstubAllEnvs());

describe("listen link tokens", () => {
  it("round-trips a valid token", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "s3cret");
    const now = Date.now();
    const p = verifyListenToken(createListenToken(PID, "mr", undefined, now), now);
    expect(p).toEqual({ patientId: PID, lang: "mr", exp: Math.floor(now / 1000) + LISTEN_LINK_DEFAULT_TTL_SECONDS });
  });

  it("rejects a tampered payload or signature", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "s3cret");
    const token = createListenToken(PID, "hi");
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ p: "other", l: "hi", e: 9999999999 })).toString("base64url");
    expect(verifyListenToken(`${forged}.${sig}`)).toBeNull();
    // Change the FIRST signature character: it always alters the decoded bytes. (Replacing the last
    // characters is flaky: the final base64url char carries padding bits, so ~1/1000 of such
    // "tampered" signatures decode to identical bytes.)
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyListenToken(`${payload}.${flipped}`)).toBeNull();
    expect(verifyListenToken(`${payload}.${sig.slice(0, -4)}`)).toBeNull();
    expect(verifyListenToken(payload)).toBeNull();
    expect(verifyListenToken("")).toBeNull();
    expect(verifyListenToken("a.b.c")).toBeNull();
  });

  it("rejects an expired token", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "s3cret");
    const now = Date.now();
    const token = createListenToken(PID, "en", 60, now);
    expect(verifyListenToken(token, now + 59_000)).not.toBeNull();
    expect(verifyListenToken(token, now + 61_000)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "one");
    const token = createListenToken(PID, "gu");
    vi.stubEnv("LISTEN_LINK_SECRET", "two");
    expect(verifyListenToken(token)).toBeNull();
  });

  it("fails closed when the secret is unset", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "");
    vi.stubEnv("DEMO_MODE", "");
    expect(() => createListenToken(PID, "hi")).toThrow();
    expect(verifyListenToken("x.y")).toBeNull();
  });

  it("uses a dev fallback only in pure offline demo (demo mode, no Supabase)", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "");
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(verifyListenToken(createListenToken(PID, "hi"))?.patientId).toBe(PID);
  });

  it("fails closed in demo mode when Supabase is configured", () => {
    vi.stubEnv("LISTEN_LINK_SECRET", "");
    vi.stubEnv("DEMO_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k");
    expect(() => createListenToken(PID, "hi")).toThrow();
  });
});

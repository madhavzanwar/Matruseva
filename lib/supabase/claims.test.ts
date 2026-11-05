import { describe, expect, it } from "vitest";
import { getClaimsBounded, isSupabaseAuthCookie } from "./claims";

const client = (p: () => Promise<{ data: { claims: { sub: string } } | null; error: unknown }>) => ({
  auth: { getClaims: p },
});

describe("getClaimsBounded", () => {
  it("returns the user id on success", async () => {
    const r = await getClaimsBounded(client(async () => ({ data: { claims: { sub: "u1" } }, error: null })));
    expect(r).toEqual({ userId: "u1", failed: false });
  });

  it("is signed out but not failed when there is no session", async () => {
    const r = await getClaimsBounded(client(async () => ({ data: null, error: null })));
    expect(r).toEqual({ userId: undefined, failed: false });
  });

  it("flags auth errors and throws as failed", async () => {
    expect((await getClaimsBounded(client(async () => ({ data: null, error: new Error("x") })))).failed).toBe(true);
    expect(
      (
        await getClaimsBounded(
          client(async () => {
            throw new Error("x");
          })
        )
      ).failed
    ).toBe(true);
  });

  it("gives up after the timeout instead of waiting for a stuck refresh", async () => {
    const start = Date.now();
    const r = await getClaimsBounded(client(() => new Promise(() => {})), 50);
    expect(r.failed).toBe(true);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("isSupabaseAuthCookie", () => {
  it("matches plain and chunked auth cookies only", () => {
    expect(isSupabaseAuthCookie("sb-abc-auth-token")).toBe(true);
    expect(isSupabaseAuthCookie("sb-abc-auth-token.1")).toBe(true);
    expect(isSupabaseAuthCookie("matrusetu_locale")).toBe(false);
    expect(isSupabaseAuthCookie("auth-token")).toBe(false);
  });
});

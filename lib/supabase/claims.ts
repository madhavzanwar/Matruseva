/** Longest we let a session check block a request before treating the user as signed out. */
export const CLAIMS_TIMEOUT_MS = 3_000;

type ClaimsClient = {
  auth: {
    getClaims(): Promise<{ data: { claims: { sub: string } } | null; error: unknown }>;
  };
};

/**
 * getClaims() with a hard time bound. auth-js retries a failed token refresh
 * with exponential backoff (~25s) when Supabase is down/unreachable, which would
 * stall every request; here that becomes "signed out" after `ms`.
 * `failed` means a session cookie existed but could not be verified/refreshed.
 */
export async function getClaimsBounded(
  supabase: ClaimsClient,
  ms = CLAIMS_TIMEOUT_MS
): Promise<{ userId?: string; failed: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    const result = await Promise.race([supabase.auth.getClaims(), timeout]);
    if (result === "timeout") return { failed: true };
    return { userId: result.data?.claims.sub, failed: !!result.error };
  } catch {
    return { failed: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Supabase auth cookie incl. chunked variants (sb-<ref>-auth-token, .0, .1, ...). */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

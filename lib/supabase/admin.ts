import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { fetchWithTimeout } from "./fetch";

/**
 * Service-role client. Bypasses RLS — use only for operations that must
 * cross clinic/staff boundaries by design (e.g. inviting staff via the
 * Supabase Admin API). Never import this into client components.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: fetchWithTimeout() } }
  );
}

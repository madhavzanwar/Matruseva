import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGnaniConfig } from "@/lib/gnani/config";
import { getSharedPool } from "@/lib/gnani/pool";
import { getLimiter } from "@/lib/gnani/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/gnani/status (authenticated staff). Lets the client choose
 * Gnani-vs-browser speech. Never returns keys or the base URL.
 */
export async function GET() {
  let userId: string;
  try {
    userId = (await getCurrentUser()).userId;
  } catch {
    return NextResponse.json({ ok: false, code: "unauthenticated", retryable: false }, { status: 401, headers: NO_STORE });
  }
  const c = getGnaniConfig();
  const configured = c.enabled && c.keys.length > 0;
  const pool = configured ? getSharedPool(c.keys).getStatus() : undefined;
  return NextResponse.json(
    {
      enabled: configured,
      sttModel: c.sttModel,
      ttsModel: c.ttsModel,
      keyCount: c.keys.length,
      circuitOpen: pool?.circuitOpen ?? false,
      budgetRemaining: getLimiter().budgetRemaining(userId),
    },
    { headers: NO_STORE },
  );
}

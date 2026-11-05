import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadCounselingDataForStaff } from "@/lib/counselingData";
import { counselFail, isCounselLanguage, parsePartParam, respondCounsel } from "@/lib/gnani/counselRoute";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/gnani/tts/counsel?patientId=<uuid>&lang=hi|mr|gu|en[&part=n]   (staff session required)
 *   no part -> 200 { ok:true, parts, language, version }       Cache-Control: private, no-store
 *   part=n  -> 200/206 audio/mpeg (Range supported)             Cache-Control: private, max-age=3600, immutable
 *   else    -> { ok:false, code, retryable }  401 unauthenticated | 400 bad_request/bad_language |
 *              404 patient_not_found (also other clinic) | 429 rate_limited/budget_exceeded (+Retry-After) |
 *              503 gnani_not_configured/gnani_unavailable (=> play the browser voice)
 * The text is built server-side from the patient's data; the caller never supplies any.
 */
export async function GET(request: Request) {
  let user;
  try {
    user = await getCurrentUser();
  } catch {
    return counselFail(401, "unauthenticated");
  }

  const params = new URL(request.url).searchParams;
  const lang = params.get("lang");
  if (!isCounselLanguage(lang)) return counselFail(400, "bad_language");
  const part = parsePartParam(params.get("part"));
  if (part === "invalid") return counselFail(400, "bad_request");
  const patientId = params.get("patientId") ?? "";
  const demo = user.isDemo === true;
  if (!demo && !z.string().uuid().safeParse(patientId).success) return counselFail(404, "patient_not_found");

  return respondCounsel({
    request,
    lang,
    part,
    budgetKey: user.userId,
    // RLS client + explicit clinic pin: another clinic's patient is simply "not found".
    load: async () =>
      loadCounselingDataForStaff(demo ? null : await createClient(), patientId, { demo, clinicId: user.clinicId }),
    notFound: () => counselFail(404, "patient_not_found"),
  });
}

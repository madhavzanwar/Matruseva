import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDemoPatientDetail } from "@/lib/demo-data";
import { gestationalAge } from "@/lib/pregnancy";
import { parseLocalDate } from "@/lib/format";
import { todayInClinicTimezone } from "@/lib/today";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CounselingPatientData } from "@/lib/voiceCounselor";
import type { Database } from "@/lib/supabase/types";

/**
 * Single place that turns a patient row (+ latest visit) into the minimal
 * CounselingPatientData used to build the counselling script, for:
 *  - the public signed listen link (service-role client, token already verified),
 *  - staff (RLS client: the database scopes rows to the caller's clinic),
 *  - demo mode (static demo data).
 * Only these fields ever leave the server. NO phone, address or other PII
 * (the phone is always null here).
 *
 * Returns null when the patient does not exist / is not visible.
 */

export const DEFAULT_CLINIC_NAME = "MatruSetu Clinic";

interface PatientCore {
  id: string;
  name: string;
  age: number | null;
  lmp: string | null;
}
interface LatestVitals {
  bp_sys: number | null;
  bp_dia: number | null;
  hb: number | null;
  fhr: number | null;
}

function toData(p: PatientCore, latest: LatestVitals | null | undefined, clinicName: string): CounselingPatientData {
  const lmpDate = p.lmp ? parseLocalDate(p.lmp) : null;
  const ga = lmpDate ? gestationalAge(lmpDate, todayInClinicTimezone()) : null;
  return {
    patientId: p.id,
    patientName: p.name,
    phone: null,
    age: p.age,
    gaWeeks: ga?.weeks ?? null,
    bpSys: latest?.bp_sys ?? null,
    bpDia: latest?.bp_dia ?? null,
    hb: latest?.hb ?? null,
    fhr: latest?.fhr ?? null,
    clinicName,
  };
}

function loadDemo(patientId: string): CounselingPatientData | null {
  const demo = getDemoPatientDetail(patientId);
  if (!demo) return null;
  const p = demo.patient;
  return toData({ id: p.id, name: p.name, age: p.age, lmp: p.lmp }, demo.visits[0] ?? null, DEFAULT_CLINIC_NAME);
}

async function loadFrom(
  db: SupabaseClient<Database>,
  patientId: string,
  clinicId?: string,
): Promise<CounselingPatientData | null> {
  let patientQuery = db.from("patients").select("id, name, age, lmp, clinic_id").eq("id", patientId);
  if (clinicId) patientQuery = patientQuery.eq("clinic_id", clinicId);
  const [{ data: p }, { data: vList }] = await Promise.all([
    patientQuery.maybeSingle(),
    db
      .from("visits")
      .select("bp_sys, bp_dia, hb, fhr")
      .eq("patient_id", patientId)
      .order("visit_date", { ascending: false })
      .limit(1),
  ]);
  if (!p) return null;
  let clinicName = DEFAULT_CLINIC_NAME;
  if (p.clinic_id) {
    const { data: clinic } = await db.from("clinics").select("name").eq("id", p.clinic_id).maybeSingle();
    if (clinic?.name) clinicName = clinic.name;
  }
  return toData(p, vList?.[0] ?? null, clinicName);
}

/** Public signed-link path. The caller must already have verified the token. Uses the service-role client. */
export async function loadCounselingDataForToken(
  patientId: string,
  opts: { demo: boolean },
): Promise<CounselingPatientData | null> {
  if (opts.demo) return loadDemo(patientId);
  return loadFrom(createAdminClient(), patientId);
}

/**
 * Staff path. `supabase` MUST be the caller's RLS client (lib/supabase/server);
 * pass `clinicId` to additionally pin the patient to the caller's clinic.
 */
export async function loadCounselingDataForStaff(
  supabase: SupabaseClient<Database> | null,
  patientId: string,
  opts: { demo: boolean; clinicId?: string },
): Promise<CounselingPatientData | null> {
  if (opts.demo) return loadDemo(patientId);
  if (!supabase) return null;
  return loadFrom(supabase, patientId, opts.clinicId);
}

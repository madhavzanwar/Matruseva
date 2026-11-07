"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isDemoActive } from "@/lib/auth";
import { generateSchedule, type ScheduleTemplateItem } from "@/lib/schedule";
import { todayInClinicTimezone, toISODate } from "@/lib/today";
import { eddFromLmp } from "@/lib/pregnancy";
import { addDemoPatient } from "@/lib/demo-data";
import { questionnaireFromFormFields } from "@/lib/obstetricQuestionnaire";
import type { CareEventKind } from "@/lib/supabase/enums";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate-client";

export interface ActionResult {
  error: string | null;
}

function makePatientSchema(t: Translator) {
  return z.object({
  name: z.string().trim().min(2, t("patients.error.name")),
  clinicPatientNo: z.string().trim().max(40).optional(),
  phone: z.string().optional(),
  altPhone: z.string().optional(),
  age: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().positive().max(70).nullable().optional()
  ),
  address: z.string().optional(),
  gravida: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().nonnegative().max(20).nullable().optional()
  ),
  para: z.preprocess(
    (v) => (v === "" || v === undefined ? null : v),
    z.coerce.number().int().nonnegative().max(20).nullable().optional()
  ),
  bloodGroup: z.string().optional(),
  // Unchecked checkboxes are omitted from FormData entirely (not just
  // undefined-valued), so this key must be .optional() to allow that.
  rhNegative: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  lmp: z.iso.date(t("patients.error.lmpInvalid")).refine((val) => {
    const today = toISODate(todayInClinicTimezone());
    return val <= today;
  }, { message: t("patients.error.lmpFuture") }),
  });
}

export async function createPatient(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { t } = await getT();
  const raw = Object.fromEntries(formData.entries());
  const parsed = makePatientSchema(t).safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  // Past-pregnancy questionnaire (components/ObstetricQuestionnaireFields). Always
  // validated and normalised here (unknown ids dropped, hidden answers reset), and
  // malformed fields fall back to defaults instead of throwing. `undefined` when the
  // form did not include it.
  const questionnaire = questionnaireFromFormFields(raw);

  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);

  if (isDemo) {
    const newId = addDemoPatient({
      name: input.name,
      clinicPatientNo: input.clinicPatientNo || null,
      phone: input.phone || null,
      altPhone: input.altPhone || null,
      age: input.age ?? null,
      address: input.address || null,
      gravida: input.gravida ?? null,
      para: input.para ?? null,
      bloodGroup: input.bloodGroup || null,
      rhNegative: input.rhNegative,
      lmp: input.lmp,
      obstetricQuestionnaire: questionnaire,
    });

    revalidatePath("/patients");
    revalidatePath("/today");
    revalidatePath("/calls");
    redirect(`/patients/${newId}`);
  }

  let createdPatientId: string | null = null;

  try {
    const [supabase, me] = await Promise.all([createClient(), getCurrentUser()]);
    const profile = { clinic_id: me.clinicId };

    const [y, m, d] = input.lmp.split("-").map(Number);
    const lmpDate = new Date(y, m - 1, d);
    const calculatedEdd = toISODate(eddFromLmp(lmpDate));

    // NOTE: `questionnaire` is intentionally NOT stored on this path. The `patients`
    // table has no columns for it (adding them needs a migration, which is out of
    // scope for now), so only the demo store above persists it. Real-mode patients
    // keep the gravida/para-derived history on the 1-page report.
    const { data: patient, error: insertError } = await supabase
      .from("patients")
      .insert({
        clinic_id: profile.clinic_id,
        name: input.name,
        clinic_patient_no: input.clinicPatientNo || null,
        phone: input.phone || null,
        alt_phone: input.altPhone || null,
        age: input.age ?? null,
        address: input.address || null,
        gravida: input.gravida ?? null,
        para: input.para ?? null,
        blood_group: input.bloodGroup || null,
        rh_negative: input.rhNegative,
        lmp: input.lmp,
        edd: calculatedEdd,
        edd_source: "lmp",
        created_by: me.userId,
      })
      .select("id")
      .single();

    if (insertError || !patient) {
      return { error: insertError?.message ?? t("patients.error.createFailed") };
    }

    await generateScheduleForPatient(supabase, {
      clinicId: profile.clinic_id,
      patientId: patient.id,
      lmp: input.lmp,
      rhNegative: input.rhNegative,
    });

    createdPatientId = patient.id;
  } catch (err: unknown) {
    console.error("createPatient error:", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : t("patients.error.dbConnection"),
    };
  }

  if (createdPatientId) {
    revalidatePath("/patients");
    revalidatePath("/today");
    revalidatePath("/calls");
    redirect(`/patients/${createdPatientId}`);
  }

  return { error: t("patients.error.createFailedFinal") };
}

async function generateScheduleForPatient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  params: { clinicId: string; patientId: string; lmp: string; rhNegative: boolean }
) {
  const { data: template } = await supabase
    .from("schedule_templates")
    .select("id")
    .eq("clinic_id", params.clinicId)
    .eq("is_default", true)
    .maybeSingle();

  if (!template) return;

  const { data: items } = await supabase
    .from("schedule_template_items")
    .select("id, code, name, kind, window_start_week, window_end_week, condition, is_critical")
    .eq("template_id", template.id);

  if (!items || items.length === 0) return;

  const scheduleItems: ScheduleTemplateItem[] = items.map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
    kind: i.kind as CareEventKind,
    windowStartWeek: i.window_start_week,
    windowEndWeek: i.window_end_week,
    condition: i.condition,
    isCritical: i.is_critical,
  }));

  const [y, m, d] = params.lmp.split("-").map(Number);
  const lmpDate = new Date(y, m - 1, d);
  const today = todayInClinicTimezone();

  const careEvents = generateSchedule(
    lmpDate,
    scheduleItems,
    { rhNegative: params.rhNegative },
    today
  );

  const rows = careEvents.map((ce) => ({
    clinic_id: params.clinicId,
    patient_id: params.patientId,
    template_item_id: ce.templateItemId,
    name: ce.name,
    kind: ce.kind,
    due_from: toISODate(ce.dueFrom),
    due_to: toISODate(ce.dueTo),
    skipped_reason: ce.skippedReason,
  }));

  await supabase.from("care_events").insert(rows);
}

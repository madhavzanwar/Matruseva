"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isDemoActive } from "@/lib/auth";
import { todayInClinicTimezone, toISODate } from "@/lib/today";
import { formatDate, parseLocalDate } from "@/lib/format";
import { closeDemoPregnancy, getDemoPatientDetail, markDemoCareEventDone, recordDemoVisit, updateDemoPatient } from "@/lib/demo-data";
import { isDuplicateRequest } from "@/lib/idempotency";
import { eddFromLmp } from "@/lib/pregnancy";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/messages";
import { createListenToken, ListenLinkConfigError } from "@/lib/listenLink";
import { COUNSELING_LANGUAGES, type CounselingLanguage } from "@/lib/voiceCounselor";
import {
  generateSchedule,
  diffRegeneratedSchedule,
  type ScheduleTemplateItem,
  type ExistingCareEvent,
  type CareEventKind,
} from "@/lib/schedule";

export interface ActionResult {
  error: string | null;
}

/** Every page that renders per-patient schedule/visit/risk data. */
function revalidatePatientViews(patientId: string) {
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  revalidatePath("/today");
  revalidatePath("/calls");
}

export async function markCareEventDone(careEventId: string, patientId: string): Promise<ActionResult> {
  const { t } = await getT();
  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  if (isDemo) {
    markDemoCareEventDone(careEventId, patientId);
    revalidatePatientViews(patientId);
    return { error: null };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("care_events")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", careEventId);

    if (error) return { error: error.message };

    revalidatePatientViews(patientId);
    return { error: null };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : t("patientDetail.error.dbConnection") };
  }
}

const visitSchema = z.object({
  visitDate: z.iso.date().optional().or(z.literal("")),
  bpSys: z.coerce.number().int().positive().optional().or(z.literal("")),
  bpDia: z.coerce.number().int().positive().optional().or(z.literal("")),
  weight: z.coerce.number().positive().optional().or(z.literal("")),
  hb: z.coerce.number().positive().optional().or(z.literal("")),
  fhr: z.coerce.number().int().positive().optional().or(z.literal("")),
  fundalHeight: z.coerce.number().positive().optional().or(z.literal("")),
  notes: z.string().optional(),
  nextVisitDate: z.iso.date().optional().or(z.literal("")),
  // Idempotency key from the offline queue / client (optional, backwards compatible).
  clientRequestId: z.uuid().optional().or(z.literal("")),
});

const VISIT_FIELD_LABELS: Record<string, MessageKey> = {
  bpSys: "visits.form.bpSys",
  bpDia: "visits.form.bpDia",
  weight: "visits.form.weight",
  hb: "visits.form.hb",
  fhr: "visits.form.fhr",
  fundalHeight: "visits.form.fundalHeight",
};

export async function recordVisit(
  patientId: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getT();
  const raw = Object.fromEntries(formData.entries());
  const parsed = visitSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? "");
    const label = VISIT_FIELD_LABELS[field];
    if (field === "visitDate" || field === "nextVisitDate") return { error: t("visits.error.invalidDate") };
    return { error: label ? t("visits.error.invalidNumber", { field: t(label) }) : t("visits.error.invalid") };
  }
  const v = parsed.data;
  const num = (x: number | "" | undefined) => (x === "" || x === undefined ? null : x);
  const clientRequestId = v.clientRequestId || undefined;

  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  if (isDemo) {
    recordDemoVisit(patientId, {
      visitDate: v.visitDate || toISODate(todayInClinicTimezone()),
      bpSys: num(v.bpSys),
      bpDia: num(v.bpDia),
      weight: num(v.weight),
      hb: num(v.hb),
      fhr: num(v.fhr),
      fundalHeight: num(v.fundalHeight),
      notes: v.notes || null,
      nextVisitDate: v.nextVisitDate || null,
    }, clientRequestId);
    revalidatePatientViews(patientId);
    return { error: null };
  }

  try {
    const [supabase, me] = await Promise.all([createClient(), getCurrentUser()]);

    const { error } = await supabase.from("visits").insert({
      patient_id: patientId,
      clinic_id: me.clinicId,
      visit_date: v.visitDate || toISODate(todayInClinicTimezone()),
      bp_sys: num(v.bpSys),
      bp_dia: num(v.bpDia),
      weight: num(v.weight),
      hb: num(v.hb),
      fhr: num(v.fhr),
      fundal_height: num(v.fundalHeight),
      notes: v.notes || null,
      next_visit_date: v.nextVisitDate || null,
      created_by: me.userId,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
    });

    // A unique violation on our own idempotency key means an earlier attempt
    // already stored this visit (response was lost): treat as success.
    if (error && !isDuplicateRequest(error, clientRequestId)) return { error: error.message };

    revalidatePatientViews(patientId);
    return { error: null };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : t("patientDetail.error.dbConnection") };
  }
}

const closePregnancySchema = z.object({
  // Messages are mapped to the active language from the issue path/code in closePregnancy().
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deliveryMode: z.enum(["NVD", "LSCS"]),
  birthWeightKg: z.coerce.number().min(0.5).max(6.5),
  notes: z.string().optional(),
});

export type ClosePregnancyInput = z.infer<typeof closePregnancySchema>;

export async function closePregnancy(
  patientId: string,
  input: ClosePregnancyInput
): Promise<ActionResult> {
  const { t, locale } = await getT();
  const parsed = closePregnancySchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    switch (issue?.path[0]) {
      case "deliveryDate":
        return { error: t("patientDetail.error.deliveryDateRequired") };
      case "deliveryMode":
        return { error: t("patientDetail.error.deliveryModeInvalid") };
      case "birthWeightKg":
        return {
          error: t(
            issue.code === "too_small"
              ? "patientDetail.error.birthWeightMin"
              : issue.code === "too_big"
                ? "patientDetail.error.birthWeightMax"
                : "patientDetail.error.birthWeightNumber",
          ),
        };
      default:
        return { error: t("patientDetail.error.invalidInput") };
    }
  }

  const data = parsed.data;
  const today = todayInClinicTimezone();
  const todayIso = toISODate(today);

  if (data.deliveryDate > todayIso) {
    return { error: t("patientDetail.error.deliveryFuture") };
  }

  const [cookieStore, me] = await Promise.all([cookies(), getCurrentUser()]);
  const isDemo = isDemoActive(cookieStore);

  if (isDemo) {
    const demoRes = closeDemoPregnancy(patientId, data, me.fullName);
    if (demoRes.error) return demoRes;

    revalidatePatientViews(patientId);
    return { error: null };
  }

  const supabase = await createClient();

  // Verify patient exists and is currently active
  const { data: patient, error: fetchError } = await supabase
    .from("patients")
    .select("id, status, pregnancy_status, lmp, created_at")
    .eq("id", patientId)
    .maybeSingle();

  if (fetchError || !patient) {
    return { error: fetchError?.message || t("patientDetail.error.patientNotFound") };
  }

  // Idempotent rejection: reject if already closed
  if (
    patient.status === "delivered" ||
    patient.status === "closed" ||
    patient.pregnancy_status === "delivered" ||
    patient.pregnancy_status === "closed"
  ) {
    return { error: t("patientDetail.error.alreadyClosed") };
  }

  // Check delivery date does not precede LMP
  if (patient.lmp && data.deliveryDate < patient.lmp) {
    return { error: t("patientDetail.error.beforeLmp", { lmp: formatDate(patient.lmp, locale) }) };
  }

  const nowIso = new Date().toISOString();

  // Single transaction update on patients table
  const { error: updateError } = await supabase
    .from("patients")
    .update({
      status: "delivered",
      pregnancy_status: "delivered",
      delivery_date: data.deliveryDate,
      delivery_mode: data.deliveryMode,
      birth_weight_kg: data.birthWeightKg,
      closed_at: nowIso,
      closed_by: me.userId,
    })
    .eq("id", patientId);

  if (updateError) return { error: updateError.message };

  // Close active/open ANC care events so they no longer trigger overdue/due alerts
  await supabase
    .from("care_events")
    .update({ skipped_reason: "Pregnancy closed / delivered" })
    .eq("patient_id", patientId)
    .is("completed_at", null)
    .is("skipped_reason", null);

  revalidatePatientViews(patientId);
  return { error: null };
}

const updatePatientSchema = z.object({
  name: z.string().min(2),
  clinicPatientNo: z.string().trim().max(40).optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  altPhone: z.string().optional().or(z.literal("")),
  age: z.coerce.number().int().positive().max(70).optional().or(z.literal("")),
  address: z.string().optional().or(z.literal("")),
  gravida: z.coerce.number().int().nonnegative().max(20).optional().or(z.literal("")),
  para: z.coerce.number().int().nonnegative().max(20).optional().or(z.literal("")),
  bloodGroup: z.string().optional().or(z.literal("")),
  rhNegative: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  lmp: z.iso.date(),
  edd: z.iso.date().optional().or(z.literal("")),
  eddSource: z.enum(["lmp", "scan", "manual"]).default("lmp"),
});

export async function updatePatient(
  patientId: string,
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { t } = await getT();
  const raw = Object.fromEntries(formData.entries());
  const parsed = updatePatientSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      error: t(
        field === "name"
          ? "patientDetail.error.nameRequired"
          : field === "lmp"
            ? "patientDetail.error.lmpInvalid"
            : "patientDetail.error.invalidInput",
      ),
    };
  }
  const input = parsed.data;

  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  if (isDemo) {
    const lmpDate = input.lmp ? parseLocalDate(input.lmp) : null;
    let finalEdd = input.edd || null;
    if (input.eddSource === "lmp" && lmpDate) {
      finalEdd = toISODate(eddFromLmp(lmpDate));
    }
    updateDemoPatient(patientId, {
      name: input.name,
      clinicPatientNo: input.clinicPatientNo || null,
      phone: input.phone || null,
      altPhone: input.altPhone || null,
      age: typeof input.age === "number" ? input.age : null,
      address: input.address || null,
      gravida: typeof input.gravida === "number" ? input.gravida : null,
      para: typeof input.para === "number" ? input.para : null,
      bloodGroup: input.bloodGroup || null,
      rhNegative: input.rhNegative,
      lmp: input.lmp || null,
      edd: finalEdd,
    });
    revalidatePatientViews(patientId);
    return { error: null };
  }

  const [supabase, me] = await Promise.all([createClient(), getCurrentUser()]);

  // Fetch current patient record to check if LMP or Rh changed
  const { data: currentPatient, error: fetchErr } = await supabase
    .from("patients")
    .select("lmp, edd, rh_negative, status, pregnancy_status")
    .eq("id", patientId)
    .single();

  if (fetchErr || !currentPatient) {
    return { error: fetchErr?.message ?? t("patientDetail.error.patientNotFound") };
  }

  // Calculate final EDD
  let finalEdd = input.edd || null;
  if (!finalEdd || input.eddSource === "lmp") {
    const [y, m, d] = input.lmp.split("-").map(Number);
    const lmpDate = new Date(y, m - 1, d);
    finalEdd = toISODate(eddFromLmp(lmpDate));
  }

  // Update patient demographics and dating
  const { error: updateErr } = await supabase
    .from("patients")
    .update({
      name: input.name,
      clinic_patient_no: input.clinicPatientNo || null,
      phone: input.phone || null,
      alt_phone: input.altPhone || null,
      age: input.age === "" || input.age === undefined ? null : input.age,
      address: input.address || null,
      gravida: input.gravida === "" || input.gravida === undefined ? null : input.gravida,
      para: input.para === "" || input.para === undefined ? null : input.para,
      blood_group: input.bloodGroup || null,
      rh_negative: input.rhNegative,
      lmp: input.lmp,
      edd: finalEdd,
      edd_source: input.eddSource,
      updated_at: new Date().toISOString(),
    })
    .eq("id", patientId);

  if (updateErr) {
    return { error: updateErr.message };
  }

  // If LMP or Rh Negative status changed, recalculate and diff the care events schedule
  const lmpChanged = currentPatient.lmp !== input.lmp;
  const rhChanged = currentPatient.rh_negative !== input.rhNegative;

  const pregnancyOpen =
    currentPatient.status !== "delivered" && currentPatient.status !== "closed" &&
    currentPatient.pregnancy_status !== "delivered" && currentPatient.pregnancy_status !== "closed";

  if ((lmpChanged || rhChanged) && pregnancyOpen) {
    const { data: template } = await supabase
      .from("schedule_templates")
      .select("id")
      .eq("clinic_id", me.clinicId)
      .eq("is_default", true)
      .maybeSingle();

    if (template) {
      const { data: items } = await supabase
        .from("schedule_template_items")
        .select("id, code, name, kind, window_start_week, window_end_week, condition, is_critical")
        .eq("template_id", template.id);

      if (items && items.length > 0) {
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

        const [y, m, d] = input.lmp.split("-").map(Number);
        const lmpDate = new Date(y, m - 1, d);
        const today = todayInClinicTimezone();

        const regenerated = generateSchedule(
          lmpDate,
          scheduleItems,
          { rhNegative: input.rhNegative },
          today
        );

        // Fetch existing care events for this patient
        const { data: existingCareEvents } = await supabase
          .from("care_events")
          .select("id, template_item_id, completed_at, skipped_reason")
          .eq("patient_id", patientId);

        const existingForDiff: ExistingCareEvent[] = (existingCareEvents ?? [])
          .filter((ce) => ce.template_item_id)
          .map((ce) => ({
            templateItemId: ce.template_item_id!,
            completedAt: ce.completed_at ? new Date(ce.completed_at) : null,
            // System-set skips can be reactivated by a later correction; only staff skips stick.
            manuallySkipped:
              ce.skipped_reason !== null &&
              ce.skipped_reason !== "late_booking" &&
              ce.skipped_reason !== "no_longer_applicable",
          }));

        const diff = diffRegeneratedSchedule(regenerated, existingForDiff);

        // Update dates for uncompleted & non-skipped events
        for (const upd of diff.toUpdateDates) {
          await supabase
            .from("care_events")
            .update({
              due_from: toISODate(upd.dueFrom),
              due_to: toISODate(upd.dueTo),
              skipped_reason: upd.skippedReason,
            })
            .eq("patient_id", patientId)
            .eq("template_item_id", upd.templateItemId)
            .is("completed_at", null)
            .or("skipped_reason.is.null,skipped_reason.eq.late_booking,skipped_reason.eq.no_longer_applicable");
        }

        // Items the corrected schedule no longer includes (e.g. Rh- -> Rh+ drops anti_d)
        if (diff.toSkip.length > 0) {
          await supabase
            .from("care_events")
            .update({ skipped_reason: "no_longer_applicable" })
            .eq("patient_id", patientId)
            .in("template_item_id", diff.toSkip)
            .is("completed_at", null)
            .is("skipped_reason", null);
        }

        // Insert newly applicable items (e.g. anti_d if changed to Rh-)
        if (diff.toInsert.length > 0) {
          const rowsToInsert = diff.toInsert.map((e) => ({
            clinic_id: me.clinicId,
            patient_id: patientId,
            template_item_id: e.templateItemId,
            name: e.name,
            kind: e.kind,
            due_from: toISODate(e.dueFrom),
            due_to: toISODate(e.dueTo),
            skipped_reason: e.skippedReason,
          }));
          await supabase.from("care_events").insert(rowsToInsert);
        }
      }
    }
  }

  revalidatePatientViews(patientId);
  return { error: null };
}

export interface ListenLinkResult {
  url: string | null;
  error: string | null;
}

/**
 * Builds the signed, expiring public link a mother opens from WhatsApp.
 * Staff only: the caller must be signed in and the patient must be visible to
 * them through RLS (i.e. belong to their clinic). Demo mode skips the DB check.
 */
export async function createListenLink(patientId: string, lang: CounselingLanguage): Promise<ListenLinkResult> {
  const { t } = await getT();
  if (!COUNSELING_LANGUAGES.some((l) => l.code === lang)) return { url: null, error: t("patientDetail.listen.unsupportedLanguage") };
  const me = await getCurrentUser(); // redirects to /login when signed out

  if (me.isDemo) {
    // Only sign ids that exist in the demo data.
    if (!getDemoPatientDetail(patientId)) return { url: null, error: t("patientDetail.listen.patientNotFound") };
  } else {
    if (!z.string().uuid().safeParse(patientId).success) return { url: null, error: t("patientDetail.listen.patientNotFound") };
    const supabase = await createClient();
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("id", patientId)
      .eq("clinic_id", me.clinicId)
      .maybeSingle();
    if (!patient) return { url: null, error: t("patientDetail.listen.patientNotFound") };
  }

  try {
    const token = createListenToken(patientId, lang);
    let base = process.env.NEXT_PUBLIC_SITE_URL;
    if (!base) {
      const h = await headers();
      const host = h.get("x-forwarded-host") ?? h.get("host");
      base = host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "http://localhost:3000";
    }
    return { url: `${base.replace(/\/+$/, "")}/listen/${token}`, error: null };
  } catch (err) {
    if (err instanceof ListenLinkConfigError) return { url: null, error: t("patientDetail.listen.notConfigured") };
    return { url: null, error: t("patientDetail.listen.createFailed") };
  }
}

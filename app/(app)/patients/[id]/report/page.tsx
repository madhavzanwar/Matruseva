import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isDemoActive } from "@/lib/auth";
import { getDemoPatientDetail } from "@/lib/demo-data";
import { gestationalAge, formatGALocalized, trimester } from "@/lib/pregnancy";
import { getT } from "@/lib/i18n/server";
import { todayInClinicTimezone, toISODate } from "@/lib/today";
import { parseLocalDate } from "@/lib/format";
import { patientFlags, vitalsFlags, sortFlags, localizeFlags } from "@/lib/clinical";
import { getPatientObstetricData } from "@/lib/obstetricReportData";
import { localizeRiskFlags } from "@/lib/obstetricQuestionnaire";
import { OnePagePatientReport } from "@/components/OnePagePatientReport";
import type { Database } from "@/lib/supabase/types";
import type { CareEventStatus, FollowUpRisk } from "@/lib/supabase/enums";

type PatientRecord = Database["public"]["Tables"]["patients"]["Row"];
type VisitRecord = Database["public"]["Tables"]["visits"]["Row"];

interface CareEventRecord {
  id: string;
  name: string;
  kind: string;
  due_from: string;
  due_to: string;
  completed_at: string | null;
  status: CareEventStatus;
}

export default async function PatientReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  const { t } = await getT();
  const [me, supabase] = await Promise.all([getCurrentUser(), createClient()]);

  let patient: PatientRecord | null = null;
  let careEvents: CareEventRecord[] = [];
  let visits: VisitRecord[] = [];
  let riskValue: FollowUpRisk = "on_track";
  // Registration questionnaire. Only the demo store keeps it: the real `patients`
  // table has no columns for it (no migration), so real-mode reports always fall
  // back to the gravida/para-derived history.
  let storedQuestionnaire: unknown = null;

  if (isDemo) {
    const demo = getDemoPatientDetail(id);
    if (!demo) notFound();
    // `unknown` hop: the demo patient also carries `obstetricQuestionnaire`, which the DB row type has no column for.
    patient = demo.patient as unknown as PatientRecord;
    storedQuestionnaire = demo.patient.obstetricQuestionnaire;
    careEvents = demo.careEvents as CareEventRecord[];
    visits = demo.visits.map((v) => ({
      id: v.id,
      patient_id: v.patient_id,
      clinic_id: "00000000-0000-0000-0000-000000000002",
      visit_date: v.visit_date,
      bp_sys: v.bp_sys,
      bp_dia: v.bp_dia,
      hb: v.hb,
      fhr: v.fhr,
      weight: v.weight,
      fundal_height: v.fundal_height,
      ga_weeks: null,
      notes: v.notes,
      next_visit_date: v.next_visit_date,
      created_at: v.created_at,
      created_by: null,
      client_request_id: null,
    }));
    riskValue = (demo.risk?.risk as FollowUpRisk) ?? "on_track";
  } else {
    const [pRes, ceRes, vRes, rRes] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("care_event_status")
        .select("id, name, kind, due_from, due_to, completed_at, status")
        .eq("patient_id", id)
        .order("due_from"),
      supabase
        .from("visits")
        .select("*")
        .eq("patient_id", id)
        .order("visit_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("patient_followup_risk").select("risk").eq("patient_id", id).maybeSingle(),
    ]);

    patient = pRes.data as PatientRecord | null;
    careEvents = (ceRes.data ?? []) as CareEventRecord[];
    visits = (vRes.data ?? []) as VisitRecord[];
    riskValue = (rRes.data?.risk as FollowUpRisk) ?? "on_track";
  }

  if (!patient) notFound();

  const today = todayInClinicTimezone();
  const lmp = patient.lmp ? parseLocalDate(patient.lmp) : null;
  const ga = lmp ? gestationalAge(lmp, today) : null;
  const eddIso =
    patient.edd ?? (lmp ? toISODate(new Date(lmp.getFullYear(), lmp.getMonth(), lmp.getDate() + 280)) : null);

  const latestVisit = visits[0];
  const clinicalFlags = sortFlags([
    ...(latestVisit
      ? vitalsFlags({
          bpSys: latestVisit.bp_sys,
          bpDia: latestVisit.bp_dia,
          hb: latestVisit.hb,
          fhr: latestVisit.fhr,
        })
      : []),
    ...patientFlags({
      age: patient.age,
      gravida: patient.gravida,
      rhNegative: patient.rh_negative,
      bloodGroup: patient.blood_group,
      gaWeeks: ga?.weeks ?? null,
    }),
  ]);

  const { pastHistory, familyHistory, scans, questionnaireRiskFlags } = getPatientObstetricData(
    patient.id,
    patient.name,
    patient.gravida ?? 1,
    patient.para ?? 0,
    patient.rh_negative,
    storedQuestionnaire ? { answers: storedQuestionnaire, t } : null
  );

  const formattedVisits = visits.map((v, idx) => {
    const prev = visits[idx + 1];
    const weightChange = v.weight !== null && prev?.weight != null ? v.weight - prev.weight : null;
    const vga = lmp ? formatGALocalized(gestationalAge(lmp, parseLocalDate(v.visit_date)), t) : null;

    return {
      visitDate: v.visit_date,
      gaWeeks: vga,
      bpSys: v.bp_sys,
      bpDia: v.bp_dia,
      weight: v.weight,
      weightChange,
      hb: v.hb,
      fhr: v.fhr,
      fundalHeight: v.fundal_height,
      notes: v.notes,
    };
  });

  const formattedCareEvents = careEvents.map((ce) => ({
    name: ce.name,
    kind: ce.kind,
    status: (ce.status as "done" | "due" | "overdue" | "upcoming") || "upcoming",
    completedAt: ce.completed_at,
    dueTo: ce.due_to,
  }));

  return (
    <OnePagePatientReport
      patient={{
        id: patient.id,
        clinicPatientNo: patient.clinic_patient_no,
        name: patient.name,
        age: patient.age,
        phone: patient.phone,
        altPhone: patient.alt_phone,
        address: patient.address,
        bloodGroup: patient.blood_group,
        rhNegative: patient.rh_negative,
        lmp: patient.lmp,
        edd: eddIso,
        gaWeeks: ga?.weeks ?? null,
        gaDaysRemainder: ga?.daysRemainder ?? null,
        trimester: ga ? trimester(ga) : null,
        gravida: patient.gravida,
        para: patient.para,
        risk: riskValue,
        clinicName: me.clinicName,
        ashaName: "Rekha Patil",
        ashaPhone: "9820199999",
      }}
      pastHistory={pastHistory}
      familyHistory={familyHistory}
      scans={scans}
      visits={formattedVisits}
      careEvents={formattedCareEvents}
      riskFlags={[
        ...localizeFlags(clinicalFlags, t).map((f) => f.label),
        ...localizeRiskFlags(questionnaireRiskFlags, t),
      ]}
    />
  );
}

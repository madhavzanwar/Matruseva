import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Phone, WhatsappLogo, FilePdf, Baby, FileText } from "@phosphor-icons/react/dist/ssr";
import { createClient } from "@/lib/supabase/server";
import { gestationalAge, formatGALocalized, trimester } from "@/lib/pregnancy";
import { getT } from "@/lib/i18n/server";
import { intlLocale } from "@/lib/i18n/intl";
import { careEventKind, careEventName, careStatusLabel, contactOutcomeLabel, documentTypeLabel, followUpRiskLabel } from "@/lib/clinicalLabels";
import { todayInClinicTimezone, toISODate } from "@/lib/today";
import { daysBetween, formatDate, formatGravidaPara, formatShortDate, parseLocalDate, relativeDays } from "@/lib/format";
import { bpFlag, hbFlag, fhrFlag, patientFlags, vitalsFlags, sortFlags, localizeFlags } from "@/lib/clinical";
import {
  telLink,
  whatsAppLink,
  allLanguageMessages,
  type MessageTemplates,
  type ReminderReason,
} from "@/lib/whatsapp";
import { getCurrentUser, isDemoActive } from "@/lib/auth";
import { MarkDoneButton } from "@/components/MarkDoneButton";
import { VisitForm } from "@/components/VisitForm";
import { PregnancyTimeline } from "@/components/PregnancyTimeline";
import { MotherHealthCardButton } from "@/components/MotherHealthCard";
import { NutritionDietButton } from "@/components/NutritionDietModal";
import { VoiceCounselorButton } from "@/components/VoiceCounselorModal";
import { ClosePregnancyForm } from "@/components/ClosePregnancyForm";
import { EditPatientButton } from "@/components/EditPatientModal";
import { VitalsTrendCharts } from "@/components/VitalsTrendCharts";
import { PatientDetailInteractive } from "@/components/PatientDetailInteractive";
import { Panel, Tag, Empty, SEVERITY_TONE, buttonPrimary, buttonSecondary, card, pageBody, th, td, type Tone } from "@/components/ui";
import type { CareEventStatus, ContactOutcome, FollowUpRisk } from "@/lib/supabase/enums";
import { getDemoPatientDetail } from "@/lib/demo-data";

const STATUS_TONE: Record<CareEventStatus, Tone> = {
  done: "ok",
  skipped: "neutral",
  upcoming: "neutral",
  due: "warning",
  overdue: "critical",
};

const RISK_TONE: Record<FollowUpRisk, Tone> = {
  on_track: "ok",
  at_risk: "warning",
  lost: "critical",
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{label}</p>
      <div className="num mt-1 text-[15px] font-semibold">{children}</div>
    </div>
  );
}

function Abn({ abnormal, children }: { abnormal: boolean; children: React.ReactNode }) {
  return <span className={abnormal ? "font-semibold text-[var(--color-overdue)]" : ""}>{children}</span>;
}

import type { Database } from "@/lib/supabase/types";

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

interface DocRecord {
  id: string;
  doc_type: string;
  doc_date: string | null;
  storage_path: string;
  ocr_text?: string | null;
  created_at: string;
}

interface ContactRecord {
  id: string;
  channel: string;
  outcome: ContactOutcome;
  notes: string | null;
  created_at: string;
}

interface RiskRecord {
  risk: FollowUpRisk;
  next_visit_date: string | null;
}

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const isDemo = isDemoActive(cookieStore);
  const { t, locale } = await getT();
  const [me, supabase] = await Promise.all([getCurrentUser(), createClient()]);

  let patient: PatientRecord | null = null;
  let careEvents: CareEventRecord[] = [];
  let visits: VisitRecord[] = [];
  let documents: DocRecord[] = [];
  let contacts: ContactRecord[] = [];
  let risk: RiskRecord | null = null;

  if (isDemo) {
    const demo = getDemoPatientDetail(id);
    // `unknown` hop: the demo patient also carries `obstetricQuestionnaire`, which the DB row type has no column for.
    patient = demo.patient as unknown as PatientRecord;
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
    documents = demo.documents as DocRecord[];
    contacts = demo.contacts as ContactRecord[];
    risk = demo.risk as RiskRecord;
  } else {
    const [pRes, ceRes, vRes, dRes, cRes, rRes] = await Promise.all([
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
      supabase
        .from("documents")
        .select("id, doc_type, doc_date, storage_path, ocr_text, created_at")
        .eq("patient_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_log")
        .select("id, channel, outcome, notes, created_at")
        .eq("patient_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("patient_followup_risk").select("risk, next_visit_date").eq("patient_id", id).maybeSingle(),
    ]);
    patient = pRes.data as PatientRecord | null;
    careEvents = (ceRes.data ?? []) as CareEventRecord[];
    visits = (vRes.data ?? []) as VisitRecord[];
    documents = (dRes.data ?? []) as DocRecord[];
    contacts = (cRes.data ?? []) as ContactRecord[];
    risk = rRes.data as RiskRecord | null;
  }

  if (!patient) notFound();

  const docs = documents ?? [];
  const { data: signed } = (!isDemo && docs.length)
    ? await supabase.storage.from("documents").createSignedUrls(docs.map((d: DocRecord) => d.storage_path), 300)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
  const patientDocs = docs.map((d) => ({
    id: d.id,
    doc_type: d.doc_type,
    doc_date: d.doc_date,
    storage_path: d.storage_path,
    ocr_text: d.ocr_text ?? null,
    url: urlByPath.get(d.storage_path) ?? null,
    created_at: d.created_at,
  }));

  const today = todayInClinicTimezone();
  const lmp = patient.lmp ? parseLocalDate(patient.lmp) : null;
  const ga = lmp ? gestationalAge(lmp, today) : null;
  const eddIso =
    patient.edd ?? (lmp ? toISODate(new Date(lmp.getFullYear(), lmp.getMonth(), lmp.getDate() + 280)) : null);
  const followUpRisk = (risk?.risk as FollowUpRisk) ?? "on_track";
  const nextVisit = risk?.next_visit_date ?? null;

  const events = (careEvents ?? []).map((ce) => ({
    id: ce.id!,
    name: ce.name!,
    kind: ce.kind!,
    dueFrom: ce.due_from!,
    dueTo: ce.due_to!,
    completedAt: ce.completed_at,
    status: ce.status as CareEventStatus,
  }));
  const openCount = events.filter((e) => e.status === "overdue").length;

  const visitList = visits ?? [];
  const latest = visitList[0];
  const flags = sortFlags([
    ...(latest ? vitalsFlags({ bpSys: latest.bp_sys, bpDia: latest.bp_dia, hb: latest.hb, fhr: latest.fhr }) : []),
    ...patientFlags({ age: patient.age, gravida: patient.gravida, rhNegative: patient.rh_negative, bloodGroup: patient.blood_group, gaWeeks: ga?.weeks ?? null }),
  ]);
  const alertFlags = localizeFlags(flags, t);

  const [{ data: clinic }] = await Promise.all([
    supabase.from("clinics").select("name, message_templates").eq("id", patient.clinic_id).single(),
  ]);

  const clinicTemplates = (clinic?.message_templates ?? {}) as MessageTemplates;
  const defaultLang = clinicTemplates.default_lang ?? "en";

  const tel = patient.phone ? telLink(patient.phone) : null;
  const firstOverdue = events.find((e) => e.status === "overdue");
  const reminderReason: ReminderReason = firstOverdue ? "overdue" : "due_soon";
  const messagesByLang = allLanguageMessages(
    patient.name,
    reminderReason,
    firstOverdue?.name,
    clinicTemplates,
    clinic?.name
  );
  const whatsappByLang = {
    en: patient.phone ? whatsAppLink(patient.phone, messagesByLang.en) : null,
    hi: patient.phone ? whatsAppLink(patient.phone, messagesByLang.hi) : null,
    mr: patient.phone ? whatsAppLink(patient.phone, messagesByLang.mr) : null,
  };
  const wa = whatsappByLang[defaultLang];

  return (
    <>
      <header className="mx-auto w-full max-w-6xl px-4 pt-6 md:px-8 md:pt-8">
        <nav aria-label={t("patientDetail.breadcrumb.aria")} className="mb-3 text-[13px] text-[var(--color-charcoal)]">
          <Link href="/patients" className="font-medium text-[var(--color-primary)] hover:underline">
            {t("patientDetail.breadcrumb.patients")}
          </Link>
          {patient.clinic_patient_no ? <span className="num"> / #{patient.clinic_patient_no}</span> : null}
        </nav>
        <div className={`overflow-hidden ${card}`}>
        <div className="flex flex-wrap items-start justify-between gap-4 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-pc-lilac)_70%,transparent)_0%,transparent_55%)] p-5">
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-[18px] font-semibold text-white"
            >
              {patient.name
                .split(/\s+/)
                .map((p) => p[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{patient.name}</h1>
            <p className="num mt-0.5 text-[13px] text-[var(--color-charcoal)]">
              {[
                patient.age ? t("patientDetail.header.ageYears", { age: patient.age }) : null,
                formatGravidaPara(patient.gravida, patient.para),
                patient.blood_group,
                patient.phone,
                patient.address,
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/patients/${patient.id}/report`}
              className="${buttonSecondary} gap-1.5"
              title={t("patientDetail.header.reportTitle")}
            >
              <FileText size={16} weight="bold" className="text-[var(--color-primary)]" aria-hidden />
              <span>{t("patientDetail.header.report")}</span>
            </Link>
            <VoiceCounselorButton
              data={{
                patientId: patient.id,
                patientName: patient.name,
                phone: patient.phone,
                age: patient.age,
                gaWeeks: ga?.weeks ?? null,
                trimester: (ga ? trimester(ga) : 2) as 1 | 2 | 3,
                bpSys: latest?.bp_sys ?? null,
                bpDia: latest?.bp_dia ?? null,
                hb: latest?.hb ?? null,
                fhr: latest?.fhr ?? null,
                riskFlags: flags.map((f) => f.label),
                nextVisitDate: firstOverdue?.dueFrom ?? null,
                clinicName: me.clinicName,
              }}
            />
            <EditPatientButton
              patient={{
                id: patient.id,
                name: patient.name,
                clinicPatientNo: patient.clinic_patient_no,
                age: patient.age,
                phone: patient.phone,
                altPhone: patient.alt_phone,
                address: patient.address,
                gravida: patient.gravida,
                para: patient.para,
                bloodGroup: patient.blood_group,
                rhNegative: patient.rh_negative,
                lmp: patient.lmp,
                edd: patient.edd,
                eddSource: (patient.edd_source as "lmp" | "scan" | "manual") || "lmp",
              }}
            />
            <MotherHealthCardButton
              patient={{
                id: patient.id,
                name: patient.name,
                clinicPatientNo: patient.clinic_patient_no,
                age: patient.age,
                phone: patient.phone,
                altPhone: patient.alt_phone,
                bloodGroup: patient.blood_group,
                rhNegative: patient.rh_negative,
                edd: eddIso ? formatShortDate(eddIso, locale) : null,
                gaLabel: ga ? `${formatGALocalized(ga, t)} · ${t("clinical.trimester.short", { n: trimester(ga) })}` : null,
                gravida: patient.gravida,
                para: patient.para,
                clinicName: me.clinicName,
              }}
            />
            <NutritionDietButton
              data={{
                patientId: patient.id,
                patientName: patient.name,
                phone: patient.phone,
                gaWeeks: ga?.weeks ?? null,
                trimester: (ga ? trimester(ga) : 2) as 1 | 2 | 3,
                hb: latest?.hb ?? null,
                clinicName: me.clinicName,
              }}
            />
            {tel && (
              <a href={tel} className={buttonPrimary}>
                <Phone size={15} weight="fill" aria-hidden /> {t("patientDetail.header.call")}
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noreferrer" className={buttonSecondary}>
                <WhatsappLogo size={15} aria-hidden /> WhatsApp
              </a>
            )}
            {!(patient.status === "delivered" || patient.status === "closed" || patient.pregnancy_status === "delivered" || patient.pregnancy_status === "closed") ? (
              <>
                <a href="#record-visit" className={buttonSecondary}>
                  {t("patientDetail.header.recordVisit")}
                </a>
                <ClosePregnancyForm
                  patient={{
                    id: patient.id,
                    name: patient.name,
                    clinicPatientNo: patient.clinic_patient_no,
                    lmp: patient.lmp,
                    edd: eddIso,
                  }}
                  todayIso={toISODate(today)}
                />
              </>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 divide-[var(--color-border)] border-t border-[var(--color-border)] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
          <Fact label={t("patientDetail.fact.ga")}>
            {(patient.status === "delivered" || patient.status === "closed" || patient.pregnancy_status === "delivered" || patient.pregnancy_status === "closed") ? (
              <span className="font-semibold text-[var(--color-on-track)]">{t("patientDetail.fact.delivered")}</span>
            ) : ga ? (
              <>
                {formatGALocalized(ga, t)} <span className="text-[12px] text-[var(--color-charcoal)]">{t("clinical.trimester.short", { n: trimester(ga) })}</span>
              </>
            ) : (
              "—"
            )}
          </Fact>
          <Fact label={t("patientDetail.fact.edd")}>
            {formatDate(eddIso, locale)}
            {eddIso && <span className="ml-1.5 text-[12px] text-[var(--color-charcoal)]">{relativeDays(eddIso, today, locale)}</span>}
          </Fact>
          <Fact label={t("patientDetail.fact.lmp")}>{formatDate(patient.lmp, locale)}</Fact>
          <Fact label={t("patientDetail.fact.nextVisit")}>
            {(patient.status === "delivered" || patient.status === "closed" || patient.pregnancy_status === "delivered" || patient.pregnancy_status === "closed") ? (
              <span className="text-[var(--color-charcoal)]">{t("patientDetail.fact.concluded")}</span>
            ) : nextVisit ? (
              <>
                {formatShortDate(nextVisit, locale)}{" "}
                <span
                  className={`text-[12px] ${
                    daysBetween(today, parseLocalDate(nextVisit)) < 0 ? "text-[var(--color-overdue)]" : "text-[var(--color-charcoal)]"
                  }`}
                >
                  {relativeDays(nextVisit, today, locale)}
                </span>
              </>
            ) : (
              t("patientDetail.fact.notBooked")
            )}
          </Fact>
          <Fact label={t("patientDetail.fact.followUp")}>
            {(patient.status === "delivered" || patient.status === "closed" || patient.pregnancy_status === "delivered" || patient.pregnancy_status === "closed") ? (
              <Tag tone="ok">{t("patientDetail.fact.delivered")}</Tag>
            ) : (
              <Tag tone={RISK_TONE[followUpRisk]}>{followUpRiskLabel(followUpRisk, t)}</Tag>
            )}
          </Fact>
          <Fact label={t("patientDetail.fact.schedule")}>
            {t("patientDetail.fact.scheduleDone", { done: events.filter((e) => e.status === "done").length, total: events.length })}
            {openCount > 0 && <span className="ml-1.5 text-[12px] text-[var(--color-overdue)]">{t("patientDetail.fact.scheduleOverdue", { count: openCount })}</span>}
          </Fact>
        </div>
        </div>
      </header>

      <div className={pageBody}>
        {(patient.status === "delivered" || patient.status === "closed" || patient.pregnancy_status === "delivered" || patient.pregnancy_status === "closed") && (
          <div className="rounded-[var(--radius-cards)] border border-[var(--color-on-track)]/40 bg-[var(--color-on-track-surface)] p-5 text-[var(--color-foreground)]">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-on-track)]/30 pb-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-on-track)] text-white">
                  <Baby size={16} weight="bold" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold text-[var(--color-on-track)]">
                    {t("patientDetail.closed.title")}
                  </h3>
                  <p className="text-[12px] text-[var(--color-charcoal)]">
                    {patient.closed_at || patient.delivery_date
                      ? t("patientDetail.closed.closedOn", { date: formatShortDate(patient.closed_at ?? patient.delivery_date, locale) })
                      : t("patientDetail.closed.closedOnRecord")}
                  </p>
                </div>
              </div>
              <Tag tone="ok">{t("patientDetail.fact.delivered")}</Tag>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 text-[13px]">
              <div>
                <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{t("patientDetail.closed.deliveryDate")}</p>
                <p className="font-semibold mt-0.5">{patient.delivery_date ? formatDate(patient.delivery_date, locale) : t("patientDetail.closed.recorded")}</p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{t("patientDetail.closed.deliveryMode")}</p>
                <p className="font-semibold mt-0.5">{patient.delivery_mode === "LSCS" ? t("clinical.delivery.LSCS") : t("clinical.delivery.NVD")}</p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{t("patientDetail.closed.birthWeight")}</p>
                <p className="num font-semibold mt-0.5">{patient.birth_weight_kg ? `${patient.birth_weight_kg} kg` : "—"}</p>
              </div>
              <div>
                <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{t("patientDetail.closed.status")}</p>
                <p className="font-semibold text-[var(--color-on-track)] mt-0.5">{t("patientDetail.closed.discharged")}</p>
              </div>
            </div>
          </div>
        )}
        {flags.length > 0 && (
          <div className={`flex flex-wrap items-center gap-2 px-4 py-3 ${card}`}>
            <span className="mr-1 text-[13px] font-semibold text-[var(--color-foreground)]">{t("patientDetail.alerts.title")}</span>
            {alertFlags.map((f) => (
              <Tag key={f.code} tone={SEVERITY_TONE[f.severity]}>
                {f.label}
              </Tag>
            ))}
          </div>
        )}

        {lmp && ga && (
          <Panel title={t("patientDetail.panel.timeline")}>
            <PregnancyTimeline lmp={patient.lmp!} gaDays={ga.days} events={events} />
          </Panel>
        )}

        <VitalsTrendCharts
          visits={visitList}
          lmp={patient.lmp}
          edd={eddIso}
          patientName={patient.name}
        />

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Panel title={t("patientDetail.panel.schedule")} count={events.length}>
              {events.length === 0 ? (
                <Empty>{t("patientDetail.schedule.empty")}</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr>
                        <th className={th}>{t("patientDetail.schedule.item")}</th>
                        <th className={th}>{t("patientDetail.schedule.window")}</th>
                        <th className={th}>{t("common.status")}</th>
                        <th className={th}>
                          <span className="sr-only">{t("patientDetail.schedule.action")}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id} className={e.status === "done" || e.status === "skipped" ? "text-[var(--color-charcoal)]" : ""}>
                          <td className={td}>
                            <p className={e.status === "done" ? "" : "font-medium"}>{careEventName(e.name, t)}</p>
                            <p className="text-[12px] capitalize text-[var(--color-charcoal)]">{careEventKind(e.kind, t)}</p>
                          </td>
                          <td className={`${td} num whitespace-nowrap text-[13px]`}>
                            {formatShortDate(e.dueFrom, locale)} – {formatShortDate(e.dueTo, locale)}
                          </td>
                          <td className={td}>
                            <Tag tone={STATUS_TONE[e.status]}>{careStatusLabel(e.status, t)}</Tag>
                            {e.status === "done" && e.completedAt && (
                              <span className="num ml-1.5 text-[12px]">{formatShortDate(e.completedAt, locale)}</span>
                            )}
                          </td>
                          <td className={`${td} text-right`}>
                            {e.status !== "done" && e.status !== "skipped" && <MarkDoneButton careEventId={e.id} patientId={id} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel title={t("patientDetail.panel.visits")} count={visitList.length}>
              {visitList.length === 0 ? (
                <Empty>{t("patientDetail.visits.empty")}</Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr>
                        <th className={th}>{t("common.date")}</th>
                        <th className={th}>GA</th>
                        <th className={th}>BP</th>
                        <th className={th}>{t("patientDetail.visits.weightKg")}</th>
                        <th className={th}>Hb</th>
                        <th className={th}>FHR</th>
                        <th className={th}>{t("patientDetail.visits.fundalCm")}</th>
                        <th className={th}>{t("common.notes")}</th>
                      </tr>
                    </thead>
                    <tbody className="num">
                      {visitList.map((v, i) => {
                        const prev = visitList[i + 1];
                        const dw = v.weight !== null && prev?.weight != null ? v.weight - prev.weight : null;
                        const vga = lmp ? formatGALocalized(gestationalAge(lmp, parseLocalDate(v.visit_date)), t) : "—";
                        return (
                          <tr key={v.id}>
                            <td className={`${td} whitespace-nowrap`}>{formatShortDate(v.visit_date, locale)}</td>
                            <td className={`${td} whitespace-nowrap text-[var(--color-charcoal)]`}>{vga}</td>
                            <td className={`${td} whitespace-nowrap`}>
                              {v.bp_sys && v.bp_dia ? (
                                <Abn abnormal={bpFlag(v.bp_sys, v.bp_dia) !== null}>
                                  {v.bp_sys}/{v.bp_dia}
                                </Abn>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={`${td} whitespace-nowrap`}>
                              {v.weight ?? "—"}
                              {dw !== null && dw !== 0 && (
                                <span className="ml-1 text-[11px] text-[var(--color-charcoal)]">
                                  {dw > 0 ? "+" : ""}
                                  {dw.toFixed(1)}
                                </span>
                              )}
                            </td>
                            <td className={td}>{v.hb ? <Abn abnormal={hbFlag(v.hb) !== null}>{v.hb}</Abn> : "—"}</td>
                            <td className={td}>{v.fhr ? <Abn abnormal={fhrFlag(v.fhr) !== null}>{v.fhr}</Abn> : "—"}</td>
                            <td className={td}>{v.fundal_height ?? "—"}</td>
                            <td className={`${td} min-w-40 text-[13px]`}>{v.notes ?? ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <div className="space-y-5">
            <Panel title={t("patientDetail.panel.recordVisit")} className="scroll-mt-4" >
              <div id="record-visit" className="p-4 pt-1">
                <PatientDetailInteractive
                  patientId={id}
                  patientName={patient.name}
                  gaLabel={ga ? formatGALocalized(ga, t) : null}
                  phone={patient.phone}
                  tel={tel}
                  wa={wa}
                  whatsappByLang={whatsappByLang}
                  messagesByLang={messagesByLang}
                  defaultLang={defaultLang}
                  documents={patientDocs}
                />
                <VisitForm patientId={id} />
              </div>
            </Panel>

            <Panel title={t("patientDetail.panel.contacts")} count={(contacts ?? []).length}>
              {(contacts ?? []).length === 0 ? (
                <Empty>{t("patientDetail.contacts.empty")}</Empty>
              ) : (
                <ul>
                  {(contacts ?? []).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 border-t border-[var(--color-border)]/70 px-4 py-3 text-[13px]">
                      <span>
                        {c.channel === "whatsapp" ? t("clinical.channel.whatsapp") : t("clinical.channel.call")} ·{" "}
                        <span className="font-medium">{contactOutcomeLabel(c.outcome as ContactOutcome, t)}</span>
                      </span>
                      <span className="num text-[12px] text-[var(--color-charcoal)]">
                        {new Date(c.created_at).toLocaleString(intlLocale(locale), {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: "Asia/Kolkata",
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel
              title={t("patientDetail.panel.documents")}
              count={docs.length}
              action={
                <Link href="/documents" className="text-[13px] font-medium text-[var(--color-primary)] hover:underline">
                  {t("patientDetail.documents.upload")}
                </Link>
              }
            >
              {docs.length === 0 ? (
                <Empty>{t("patientDetail.documents.empty")}</Empty>
              ) : (
                <ul className="grid grid-cols-2 gap-3 p-4 pt-1">
                  {docs.map((doc) => {
                    const url = urlByPath.get(doc.storage_path) ?? null;
                    const isImage = /\.(jpe?g|png|webp)$/i.test(doc.storage_path);
                    return (
                      <li key={doc.id} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]">
                        <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block hover:opacity-90">
                          {url && isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not an optimizable static asset
                            <img src={url} alt="" loading="lazy" className="h-28 w-full object-cover" />
                          ) : (
                            <div className="flex h-28 items-center justify-center bg-[var(--color-surface-1)]">
                              <FilePdf size={32} className="text-[var(--color-charcoal)]" aria-hidden />
                            </div>
                          )}
                          <p className="px-2 py-1.5 text-[12px]">
                            <span className="font-medium">{documentTypeLabel(doc.doc_type, t)}</span>{" "}
                            <span className="num text-[var(--color-charcoal)]">
                              {formatShortDate(doc.doc_date ?? doc.created_at, locale)}
                            </span>
                          </p>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

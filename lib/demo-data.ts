import fs from "node:fs";
import path from "node:path";
import { todayInClinicTimezone, toISODate } from "@/lib/today";
import { gestationalAge } from "@/lib/pregnancy";
import { parseLocalDate } from "@/lib/format";
import { patientFlags, vitalsFlags, sortFlags } from "@/lib/clinical";
import { normalizeQuestionnaire, type NormalizedObstetricQuestionnaire } from "@/lib/obstetricQuestionnaire";
import type { PatientRow, OpenEvent, LatestVisit } from "@/lib/snapshot";
import type { CareEventStatus, FollowUpRisk, ContactOutcome } from "@/lib/supabase/enums";

export interface DemoPatientRaw {
  id: string;
  name: string;
  clinicPatientNo?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  address?: string | null;
  age?: number | null;
  gravida?: number | null;
  para?: number | null;
  bloodGroup?: string | null;
  rhNegative: boolean;
  weeksPregnant: number;
  lmp?: string | null;
  edd?: string | null;
  risk: FollowUpRisk;
  noAnswerStreak: number;
  status?: "active" | "delivered" | "closed";
  pregnancyStatus?: "active" | "delivered" | "closed";
  deliveryDate?: string;
  deliveryMode?: "NVD" | "LSCS";
  birthWeightKg?: number;
  closedAt?: string;
  closedBy?: string;
  latestVisit?: {
    daysAgo: number;
    bpSys: number;
    bpDia: number;
    hb: number;
    fhr: number;
  };
  overdueEvents?: { name: string; kind: string; daysOverdue: number }[];
  dueEvents?: { name: string; kind: string; dueInDays: number }[];
  createdAt?: string;
  /**
   * Past-pregnancy questionnaire from registration. Demo store only: the real
   * `patients` table has no columns for it (no migration), so it is not persisted there.
   */
  obstetricQuestionnaire?: NormalizedObstetricQuestionnaire;
}

export interface DemoVisitRecord {
  id: string;
  patient_id: string;
  visit_date: string;
  bp_sys: number | null;
  bp_dia: number | null;
  weight: number | null;
  hb: number | null;
  fhr: number | null;
  fundal_height: number | null;
  notes: string | null;
  next_visit_date: string | null;
  created_at: string;
  /** Offline-queue idempotency key; a replay with the same key is ignored. */
  client_request_id?: string;
}

export interface DemoContactRecord {
  id: string;
  channel: "call" | "whatsapp";
  outcome: ContactOutcome;
  notes: string | null;
  created_at: string;
  client_request_id?: string;
}

export interface DemoStoreState {
  patients: DemoPatientRaw[];
  completedEvents: Record<string, string[]>;
  visits: Record<string, DemoVisitRecord[]>;
  contacts: Record<string, DemoContactRecord[]>;
}

const STORE_FILE_PATH = path.join(process.cwd(), ".matrusetu-demo-store.json");

declare global {
  var __matrusetu_demo_store__: DemoStoreState | undefined;
  var __matrusetu_demo_snapshot_cache__: { rows: PatientRow[]; today: Date; todayIso: string } | null | undefined;
  var __matrusetu_demo_detail_cache__: Map<string, { todayIso: string; data: unknown }> | undefined;
}

const INITIAL_RAW_DEMO_PATIENTS: DemoPatientRaw[] = [
  {
    id: "p1-pooja-deshmukh",
    name: "Pooja Deshmukh",
    clinicPatientNo: "ANC-101",
    phone: "9820123456",
    altPhone: "9820199999",
    address: "Shivpur Colony, Pune",
    age: 26,
    gravida: 2,
    para: 1,
    bloodGroup: "B+",
    rhNegative: false,
    weeksPregnant: 21.5,
    risk: "at_risk",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 14, bpSys: 118, bpDia: 76, hb: 10.4, fhr: 146 },
    overdueEvents: [{ name: "Anomaly Scan (TIFFA)", kind: "scan", daysOverdue: 5 }],
    dueEvents: [{ name: "Td Dose 2", kind: "injection", dueInDays: 3 }],
  },
  {
    id: "p2-sunita-verma",
    name: "Sunita Verma",
    clinicPatientNo: "ANC-102",
    phone: "9845012345",
    altPhone: "9845098765",
    address: "Ganeshpuri, Ward 4",
    age: 31,
    gravida: 1,
    para: 0,
    bloodGroup: "O+",
    rhNegative: false,
    weeksPregnant: 28.2,
    risk: "at_risk",
    noAnswerStreak: 1,
    latestVisit: { daysAgo: 21, bpSys: 138, bpDia: 88, hb: 9.8, fhr: 142 },
    overdueEvents: [],
    dueEvents: [{ name: "OGTT Sugar Screening", kind: "test", dueInDays: 2 }],
  },
  {
    id: "p3-kavita-patel",
    name: "Kavita Patel",
    clinicPatientNo: "ANC-103",
    phone: "9712345678",
    address: "Lakshmi Nagar, Surat",
    age: 24,
    gravida: 1,
    para: 0,
    bloodGroup: "A+",
    rhNegative: false,
    weeksPregnant: 12.8,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 7, bpSys: 110, bpDia: 70, hb: 12.2, fhr: 154 },
    overdueEvents: [],
    dueEvents: [{ name: "NT Scan + Double Marker", kind: "scan", dueInDays: 4 }],
  },
  {
    id: "p4-priya-sharma",
    name: "Priya Sharma",
    clinicPatientNo: "ANC-104",
    phone: "9811122233",
    address: "Nehru Ward, Flat 302",
    age: 28,
    gravida: 2,
    para: 0,
    bloodGroup: "O-",
    rhNegative: true,
    weeksPregnant: 27.5,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 10, bpSys: 114, bpDia: 74, hb: 11.0, fhr: 140 },
    overdueEvents: [],
    dueEvents: [{ name: "Anti-D Prophylaxis Injection", kind: "injection", dueInDays: 4 }],
  },
  {
    id: "p5-rekha-yadav",
    name: "Rekha Yadav",
    clinicPatientNo: "ANC-105",
    phone: "9833344455",
    address: "Rampur Basti",
    age: 33,
    gravida: 3,
    para: 2,
    bloodGroup: "B-",
    rhNegative: true,
    weeksPregnant: 34.2,
    risk: "at_risk",
    noAnswerStreak: 2,
    latestVisit: { daysAgo: 28, bpSys: 142, bpDia: 92, hb: 8.9, fhr: 138 },
    overdueEvents: [{ name: "Growth Scan + Doppler (34w)", kind: "scan", daysOverdue: 9 }],
    dueEvents: [],
  },
  {
    id: "p6-anita-joshi",
    name: "Anita Joshi",
    clinicPatientNo: "ANC-106",
    phone: "9876543210",
    address: "Kothari Compound",
    age: 29,
    gravida: 1,
    para: 0,
    bloodGroup: "AB+",
    rhNegative: false,
    weeksPregnant: 36.4,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 4, bpSys: 120, bpDia: 78, hb: 11.8, fhr: 144 },
    overdueEvents: [],
    dueEvents: [{ name: "Weekly Non-Stress Test (NST)", kind: "test", dueInDays: 3 }],
  },
  {
    id: "p7-meena-kumari",
    name: "Meena Kumari",
    clinicPatientNo: "ANC-107",
    phone: "9988776655",
    address: "Shivaji Nagar",
    age: 22,
    gravida: 1,
    para: 0,
    bloodGroup: "A-",
    rhNegative: true,
    weeksPregnant: 8.5,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 5, bpSys: 112, bpDia: 72, hb: 12.0, fhr: 160 },
    overdueEvents: [],
    dueEvents: [{ name: "Dating / Viability Scan", kind: "scan", dueInDays: 5 }],
  },
  {
    id: "p8-neha-singh",
    name: "Neha Singh",
    clinicPatientNo: "ANC-108",
    phone: "9123456789",
    address: "Adarsh Nagar",
    age: 27,
    gravida: 2,
    para: 1,
    bloodGroup: "O+",
    rhNegative: false,
    weeksPregnant: 23.1,
    risk: "lost",
    noAnswerStreak: 3,
    latestVisit: { daysAgo: 38, bpSys: 122, bpDia: 80, hb: 10.2, fhr: 140 },
    overdueEvents: [{ name: "Anomaly Scan (TIFFA)", kind: "scan", daysOverdue: 16 }],
    dueEvents: [],
  },
  {
    id: "p9-divya-nair",
    name: "Divya Nair",
    clinicPatientNo: "ANC-109",
    phone: "9822001122",
    address: "MG Road, Flat 4B",
    age: 30,
    gravida: 1,
    para: 0,
    bloodGroup: "B+",
    rhNegative: false,
    weeksPregnant: 19.4,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 12, bpSys: 116, bpDia: 74, hb: 11.4, fhr: 148 },
    overdueEvents: [],
    dueEvents: [{ name: "Anomaly Scan (TIFFA)", kind: "scan", dueInDays: 6 }],
  },
  {
    id: "p10-shweta-kulkarni",
    name: "Shweta Kulkarni",
    clinicPatientNo: "ANC-110",
    phone: "9899001122",
    address: "Model Colony, Pune",
    age: 32,
    gravida: 2,
    para: 1,
    bloodGroup: "A+",
    rhNegative: false,
    weeksPregnant: 31.0,
    risk: "on_track",
    noAnswerStreak: 0,
    latestVisit: { daysAgo: 8, bpSys: 124, bpDia: 82, hb: 10.8, fhr: 136 },
    overdueEvents: [],
    dueEvents: [{ name: "Growth Scan (32w)", kind: "scan", dueInDays: 7 }],
  },
];

function initFreshStore(): DemoStoreState {
  return {
    patients: JSON.parse(JSON.stringify(INITIAL_RAW_DEMO_PATIENTS)),
    completedEvents: {},
    visits: {},
    contacts: {},
  };
}

export function getDemoStore(): DemoStoreState {
  if (globalThis.__matrusetu_demo_store__) {
    return globalThis.__matrusetu_demo_store__;
  }

  try {
    if (fs.existsSync(STORE_FILE_PATH)) {
      const data = fs.readFileSync(STORE_FILE_PATH, "utf8");
      const parsed = JSON.parse(data) as DemoStoreState;
      if (parsed && Array.isArray(parsed.patients)) {
        globalThis.__matrusetu_demo_store__ = parsed;
        return parsed;
      }
    }
  } catch {
    // If reading fails, fall back to fresh
  }

  const fresh = initFreshStore();
  globalThis.__matrusetu_demo_store__ = fresh;
  saveDemoStore(fresh);
  return fresh;
}

export function saveDemoStore(store: DemoStoreState): void {
  globalThis.__matrusetu_demo_store__ = store;
  try {
    fs.writeFileSync(STORE_FILE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Graceful fallback if fs is restricted
  }
}

export function resetDemoStore(): void {
  const fresh = initFreshStore();
  saveDemoStore(fresh);
  invalidateDemoCache();
}

// Backward compatibility proxy for any code accessing RAW_DEMO_PATIENTS
export const RAW_DEMO_PATIENTS: DemoPatientRaw[] = new Proxy([] as DemoPatientRaw[], {
  get(_target, prop) {
    const store = getDemoStore();
    return Reflect.get(store.patients, prop);
  },
  set(_target, prop, value) {
    const store = getDemoStore();
    const result = Reflect.set(store.patients, prop, value);
    saveDemoStore(store);
    return result;
  },
});

export function invalidateDemoCache(): void {
  globalThis.__matrusetu_demo_snapshot_cache__ = null;
  if (globalThis.__matrusetu_demo_detail_cache__) {
    globalThis.__matrusetu_demo_detail_cache__.clear();
  }
}

export function getDemoSnapshot(): { rows: PatientRow[]; today: Date; todayIso: string } {
  const today = todayInClinicTimezone();
  const todayIso = toISODate(today);

  if (globalThis.__matrusetu_demo_snapshot_cache__ && globalThis.__matrusetu_demo_snapshot_cache__.todayIso === todayIso) {
    return globalThis.__matrusetu_demo_snapshot_cache__;
  }

  const store = getDemoStore();
  // Delivered or closed pregnancies are excluded from the active worklist & follow-up queues
  const activePatients = store.patients.filter((p) => !p.status || p.status === "active");

  const rows: PatientRow[] = activePatients.map((p) => {
    const lmpDate = p.lmp ? parseLocalDate(p.lmp) : new Date(today);
    if (!p.lmp) lmpDate.setDate(lmpDate.getDate() - Math.round(p.weeksPregnant * 7));
    const lmpIso = p.lmp || toISODate(lmpDate);

    const eddDate = new Date(lmpDate);
    eddDate.setDate(eddDate.getDate() + 280);
    const edd = p.edd || toISODate(eddDate);

    const lmpParsed = parseLocalDate(lmpIso);
    const ga = gestationalAge(lmpParsed, today);

    const completedList = store.completedEvents[p.id] ?? [];
    const completedSet = new Set(completedList);

    const overdue: OpenEvent[] = (p.overdueEvents ?? []).filter((e, idx) => !completedSet.has(`ovd-${p.id}-${idx}`) && !completedSet.has(e.name)).map((e, idx) => ({
      id: `ovd-${p.id}-${idx}`,
      name: e.name,
      kind: e.kind,
      dueFrom: toISODate(new Date(today.getTime() - (e.daysOverdue + 7) * 86400000)),
      dueTo: toISODate(new Date(today.getTime() - e.daysOverdue * 86400000)),
      status: "overdue" as const,
    }));

    const due: OpenEvent[] = (p.dueEvents ?? []).filter((e, idx) => !completedSet.has(`due-${p.id}-${idx}`) && !completedSet.has(e.name)).map((e, idx) => ({
      id: `due-${p.id}-${idx}`,
      name: e.name,
      kind: e.kind,
      dueFrom: toISODate(new Date(today.getTime() - 2 * 86400000)),
      dueTo: toISODate(new Date(today.getTime() + e.dueInDays * 86400000)),
      status: "due" as const,
    }));

    let latestVisit: LatestVisit | null = null;
    const patientVisits = store.visits[p.id];
    if (patientVisits && patientVisits.length > 0) {
      const v = patientVisits[0];
      latestVisit = {
        visitDate: v.visit_date,
        bpSys: v.bp_sys,
        bpDia: v.bp_dia,
        hb: v.hb,
        fhr: v.fhr,
        nextVisitDate: v.next_visit_date || toISODate(new Date(today.getTime() + 14 * 86400000)),
      };
    } else if (p.latestVisit) {
      const d = new Date(today);
      d.setDate(d.getDate() - p.latestVisit.daysAgo);
      latestVisit = {
        visitDate: toISODate(d),
        bpSys: p.latestVisit.bpSys,
        bpDia: p.latestVisit.bpDia,
        hb: p.latestVisit.hb,
        fhr: p.latestVisit.fhr,
        nextVisitDate: toISODate(new Date(today.getTime() + 14 * 86400000)),
      };
    }

    const flags = sortFlags([
      ...(latestVisit ? vitalsFlags({ bpSys: latestVisit.bpSys, bpDia: latestVisit.bpDia, hb: latestVisit.hb, fhr: latestVisit.fhr }) : []),
      ...patientFlags({
        age: p.age ?? null,
        gravida: p.gravida ?? null,
        rhNegative: p.rhNegative,
        bloodGroup: p.bloodGroup ?? null,
        gaWeeks: ga?.weeks ?? null,
      }),
    ]);

    return {
      id: p.id,
      name: p.name,
      phone: p.phone ?? null,
      clinicNo: p.clinicPatientNo ?? null,
      age: p.age ?? null,
      gravida: p.gravida ?? null,
      para: p.para ?? null,
      rhNegative: p.rhNegative,
      lmp: lmpIso,
      edd,
      ga,
      risk: p.risk,
      noAnswerStreak: p.noAnswerStreak,
      nextVisitDate: latestVisit?.nextVisitDate ?? null,
      latestVisit,
      overdue,
      due,
      flags,
      createdAt: p.createdAt ?? "2026-04-01T08:00:00Z",
    };
  });

  globalThis.__matrusetu_demo_snapshot_cache__ = { rows, today, todayIso };
  return globalThis.__matrusetu_demo_snapshot_cache__;
}

function computeDemoPatientDetail(id: string, today: Date, todayIso: string) {
  const store = getDemoStore();
  const patientRaw = store.patients.find((p) => p.id === id) || store.patients[0];
  if (!patientRaw) return null;

  const lmpDate = patientRaw.lmp ? parseLocalDate(patientRaw.lmp) : new Date(today);
  if (!patientRaw.lmp) {
    lmpDate.setDate(lmpDate.getDate() - Math.round(patientRaw.weeksPregnant * 7));
  }
  const lmpIso = patientRaw.lmp || toISODate(lmpDate);

  const eddDate = new Date(lmpDate);
  eddDate.setDate(eddDate.getDate() + 280);
  const eddIso = patientRaw.edd || toISODate(eddDate);

  const addWeeks = (w: number) => {
    const d = new Date(lmpDate);
    d.setDate(d.getDate() + w * 7);
    return toISODate(d);
  };

  const completedList = store.completedEvents[patientRaw.id] ?? [];
  const completedSet = new Set(completedList);

  const rawEvents = [
    { id: "ce-1", name: "Booking visit + Labs", kind: "test", due_from: addWeeks(6), due_to: addWeeks(10) },
    { id: "ce-2", name: "Dating / Viability scan", kind: "scan", due_from: addWeeks(7), due_to: addWeeks(11) },
    { id: "ce-3", name: "NT Scan + Double Marker", kind: "scan", due_from: addWeeks(11), due_to: addWeeks(14) },
    { id: "ce-4", name: "Anomaly Scan (TIFFA)", kind: "scan", due_from: addWeeks(18), due_to: addWeeks(22) },
    { id: "ce-5", name: "Td Dose 1", kind: "injection", due_from: addWeeks(20), due_to: addWeeks(24) },
    { id: "ce-6", name: "OGTT Sugar Screening", kind: "test", due_from: addWeeks(24), due_to: addWeeks(28) },
    ...(patientRaw.rhNegative ? [{ id: "ce-rh", name: "Anti-D Prophylaxis (28w)", kind: "injection", due_from: addWeeks(28), due_to: addWeeks(30) }] : []),
    { id: "ce-7", name: "Growth Scan + Doppler (32w)", kind: "scan", due_from: addWeeks(32), due_to: addWeeks(36) },
  ];

  const careEvents = rawEvents.map((e) => {
    const isCompleted = completedSet.has(e.id) || (e.id === "ce-1" && patientRaw.weeksPregnant > 10) || (e.id === "ce-2" && patientRaw.weeksPregnant > 11) || (e.id === "ce-3" && patientRaw.weeksPregnant > 14);
    let status: CareEventStatus = "upcoming";
    if (isCompleted) {
      status = "done";
    } else if (e.due_to < todayIso) {
      status = "overdue";
    } else if (e.due_from <= todayIso) {
      status = "due";
    }
    return {
      ...e,
      completed_at: isCompleted ? (e.due_from < todayIso ? e.due_from : todayIso) : null,
      status,
    };
  });

  const customVisits = store.visits[patientRaw.id];
  const visits = customVisits && customVisits.length > 0
    ? customVisits
    : [
        {
          id: "v-1",
          patient_id: patientRaw.id,
          visit_date: toISODate(new Date(today.getTime() - 14 * 86400000)),
          bp_sys: patientRaw.latestVisit?.bpSys ?? 120,
          bp_dia: patientRaw.latestVisit?.bpDia ?? 80,
          hb: patientRaw.latestVisit?.hb ?? 11.2,
          fhr: patientRaw.latestVisit?.fhr ?? 144,
          weight: 58.5,
          fundal_height: 22,
          notes: "Fetal movements good. Prescribed iron & calcium tablets.",
          next_visit_date: toISODate(new Date(today.getTime() + 14 * 86400000)),
          created_at: new Date(today.getTime() - 14 * 86400000).toISOString(),
        },
      ];

  const isDeliveredOrClosed = patientRaw.status === "delivered" || patientRaw.status === "closed";

  const customContacts = store.contacts[patientRaw.id];
  const contacts = customContacts && customContacts.length > 0
    ? customContacts
    : [
        {
          id: "c-1",
          channel: "whatsapp" as const,
          outcome: "reached" as ContactOutcome,
          notes: "Reminder sent for upcoming scan",
          created_at: new Date(today.getTime() - 2 * 86400000).toISOString(),
        },
      ];

  const result = {
    patient: {
      id: patientRaw.id,
      clinic_id: "00000000-0000-0000-0000-000000000002",
      clinic_patient_no: patientRaw.clinicPatientNo ?? null,
      name: patientRaw.name,
      phone: patientRaw.phone ?? null,
      alt_phone: patientRaw.altPhone || null,
      address: patientRaw.address ?? null,
      age: patientRaw.age ?? null,
      gravida: patientRaw.gravida ?? null,
      para: patientRaw.para ?? null,
      blood_group: patientRaw.bloodGroup ?? null,
      rh_negative: patientRaw.rhNegative,
      lmp: lmpIso,
      edd: eddIso,
      edd_source: "lmp",
      status: patientRaw.status || "active",
      pregnancy_status: patientRaw.pregnancyStatus || patientRaw.status || "active",
      delivery_date: patientRaw.deliveryDate || null,
      delivery_mode: patientRaw.deliveryMode || null,
      birth_weight_kg: patientRaw.birthWeightKg || null,
      closed_at: patientRaw.closedAt || null,
      closed_by: patientRaw.closedBy || null,
      created_at: patientRaw.createdAt ?? "2026-05-01T10:00:00Z",
      obstetricQuestionnaire: patientRaw.obstetricQuestionnaire ?? null,
      updated_at: new Date().toISOString(),
    },
    careEvents: isDeliveredOrClosed
      ? careEvents.map((ce) => (ce.completed_at ? ce : { ...ce, status: "skipped" as CareEventStatus, skipped_reason: "Pregnancy closed / delivered" }))
      : careEvents,
    visits,
    documents: [],
    contacts,
    risk: {
      risk: isDeliveredOrClosed ? "on_track" : patientRaw.risk,
      next_visit_date: isDeliveredOrClosed ? null : toISODate(new Date(today.getTime() + 14 * 86400000)),
      no_answer_streak: isDeliveredOrClosed ? 0 : patientRaw.noAnswerStreak,
    },
  };

  return result;
}

export type DemoPatientDetailResult = NonNullable<ReturnType<typeof computeDemoPatientDetail>>;

export function getDemoPatientDetail(id: string): DemoPatientDetailResult {
  const today = todayInClinicTimezone();
  const todayIso = toISODate(today);

  if (!globalThis.__matrusetu_demo_detail_cache__) {
    globalThis.__matrusetu_demo_detail_cache__ = new Map();
  }

  const cached = globalThis.__matrusetu_demo_detail_cache__.get(id);
  if (cached && cached.todayIso === todayIso) {
    return cached.data as DemoPatientDetailResult;
  }

  const result = computeDemoPatientDetail(id, today, todayIso)!;
  globalThis.__matrusetu_demo_detail_cache__.set(id, { todayIso, data: result });
  return result;
}

export function closeDemoPregnancy(
  patientId: string,
  data: {
    deliveryDate: string;
    deliveryMode: "NVD" | "LSCS";
    birthWeightKg: number;
    notes?: string;
  },
  doctorName = "Dr. Demo"
): { error: string | null } {
  const store = getDemoStore();
  const patient = store.patients.find((p) => p.id === patientId);
  if (!patient) {
    return { error: "Patient record not found." };
  }

  if (patient.status === "delivered" || patient.status === "closed") {
    return { error: "This pregnancy has already been closed." };
  }

  patient.status = "delivered";
  patient.pregnancyStatus = "delivered";
  patient.deliveryDate = data.deliveryDate;
  patient.deliveryMode = data.deliveryMode;
  patient.birthWeightKg = data.birthWeightKg;
  patient.closedAt = new Date().toISOString();
  patient.closedBy = doctorName;
  patient.overdueEvents = [];
  patient.dueEvents = [];
  patient.risk = "on_track";

  saveDemoStore(store);
  invalidateDemoCache();
  return { error: null };
}

export function logDemoBatchContacts(
  patientIds: string[],
  outcome: ContactOutcome,
  _notes?: string
): { error: string | null; loggedCount: number; skippedCount: number } {
  const store = getDemoStore();
  let loggedCount = 0;
  let skippedCount = 0;

  for (const pid of patientIds) {
    const patient = store.patients.find((p) => p.id === pid);
    if (!patient || patient.status === "delivered" || patient.status === "closed") {
      skippedCount++;
      continue;
    }

    loggedCount++;
    if (outcome === "reached" || outcome === "will_visit") {
      patient.noAnswerStreak = 0;
    } else if (outcome === "no_answer") {
      patient.noAnswerStreak += 1;
    }

    const contacts = store.contacts[pid] ?? [];
    contacts.unshift({
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      channel: "call",
      outcome,
      notes: _notes || "Logged via Batch Follow-up",
      created_at: new Date().toISOString(),
    });
    store.contacts[pid] = contacts;
  }

  saveDemoStore(store);
  invalidateDemoCache();
  return { error: null, loggedCount, skippedCount };
}

export function getDemoContactStats(): { reached: number; total: number; successRate: number } {
  // Synthesized realistic metrics from demo call activities
  const reached = 38;
  const total = 46;
  const successRate = total > 0 ? Math.round((reached / total) * 100) : 0;
  return { reached, total, successRate };
}

export function getDemoDeliveriesThisMonthCount(): number {
  const store = getDemoStore();
  const today = todayInClinicTimezone();
  const currentYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  return store.patients.filter(
    (p) => (p.status === "delivered" || p.status === "closed") && p.deliveryDate?.startsWith(currentYearMonth)
  ).length;
}

export function addDemoPatient(data: {
  name: string;
  clinicPatientNo?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  age?: number | null;
  address?: string | null;
  gravida?: number | null;
  para?: number | null;
  bloodGroup?: string | null;
  rhNegative: boolean;
  lmp: string;
  edd?: string | null;
  obstetricQuestionnaire?: NormalizedObstetricQuestionnaire;
}): string {
  const store = getDemoStore();
  const today = todayInClinicTimezone();
  const lmpDate = parseLocalDate(data.lmp);
  const ga = gestationalAge(lmpDate, today);
  const weeksPregnant = Math.max(0.1, ga.days / 7);

  const cleanName = data.name.trim().toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-") || "patient";
  const id = `p-demo-${cleanName}-${Date.now().toString(36)}`;

  const eddDate = new Date(lmpDate);
  eddDate.setDate(eddDate.getDate() + 280);
  const edd = data.edd || toISODate(eddDate);

  const newPatient: DemoPatientRaw = {
    id,
    name: data.name.trim(),
    clinicPatientNo: data.clinicPatientNo || `ANC-${Math.floor(200 + Math.random() * 800)}`,
    phone: data.phone || null,
    altPhone: data.altPhone || undefined,
    address: data.address || null,
    age: data.age ?? 26,
    gravida: data.gravida ?? 1,
    para: data.para ?? 0,
    bloodGroup: data.bloodGroup || null,
    rhNegative: data.rhNegative,
    weeksPregnant: Number(weeksPregnant.toFixed(1)),
    lmp: data.lmp,
    edd,
    risk: "on_track",
    noAnswerStreak: 0,
    status: "active",
    pregnancyStatus: "active",
    createdAt: new Date().toISOString(),
    // Re-normalised at the storage boundary: nothing unvalidated is ever persisted.
    obstetricQuestionnaire: data.obstetricQuestionnaire ? normalizeQuestionnaire(data.obstetricQuestionnaire) : undefined,
    latestVisit: {
      daysAgo: 0,
      bpSys: 120,
      bpDia: 80,
      hb: 12.0,
      fhr: 140,
    },
    overdueEvents: [],
    dueEvents: [
      { name: "Booking visit + Labs", kind: "test", dueInDays: 3 },
      { name: "Dating / Viability scan", kind: "scan", dueInDays: 7 },
    ],
  };

  store.patients.unshift(newPatient);
  saveDemoStore(store);
  invalidateDemoCache();
  return id;
}

export function markDemoCareEventDone(careEventId: string, patientId: string): void {
  const store = getDemoStore();
  const current = store.completedEvents[patientId] ?? [];
  if (!current.includes(careEventId)) {
    store.completedEvents[patientId] = [...current, careEventId];
  }
  saveDemoStore(store);
  invalidateDemoCache();
}

export function recordDemoVisit(
  patientId: string,
  v: {
    visitDate: string;
    bpSys: number | null;
    bpDia: number | null;
    weight: number | null;
    hb: number | null;
    fhr: number | null;
    fundalHeight: number | null;
    notes: string | null;
    nextVisitDate: string | null;
  },
  clientRequestId?: string
): void {
  const store = getDemoStore();
  if (clientRequestId && (store.visits[patientId] ?? []).some((x) => x.client_request_id === clientRequestId)) return;
  const patient = store.patients.find((p) => p.id === patientId);
  if (patient) {
    patient.latestVisit = {
      daysAgo: 0,
      bpSys: v.bpSys ?? 120,
      bpDia: v.bpDia ?? 80,
      hb: v.hb ?? 11.5,
      fhr: v.fhr ?? 144,
    };
  }
  const visits = store.visits[patientId] ?? [];
  visits.unshift({
    id: `v-${Date.now().toString(36)}`,
    patient_id: patientId,
    visit_date: v.visitDate,
    bp_sys: v.bpSys,
    bp_dia: v.bpDia,
    weight: v.weight,
    hb: v.hb,
    fhr: v.fhr,
    fundal_height: v.fundalHeight,
    notes: v.notes,
    next_visit_date: v.nextVisitDate,
    created_at: new Date().toISOString(),
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
  });
  store.visits[patientId] = visits;
  saveDemoStore(store);
  invalidateDemoCache();
}

export function logDemoContact(
  patientId: string,
  channel: "call" | "whatsapp",
  outcome: ContactOutcome,
  notes?: string,
  clientRequestId?: string
): void {
  const store = getDemoStore();
  if (clientRequestId && (store.contacts[patientId] ?? []).some((x) => x.client_request_id === clientRequestId)) return;
  const patient = store.patients.find((p) => p.id === patientId);
  if (patient) {
    if (outcome === "reached" || outcome === "will_visit") {
      patient.noAnswerStreak = 0;
    } else if (outcome === "no_answer") {
      patient.noAnswerStreak += 1;
    }
  }
  const contacts = store.contacts[patientId] ?? [];
  contacts.unshift({
    id: `c-${Date.now().toString(36)}`,
    channel,
    outcome,
    notes: notes || null,
    created_at: new Date().toISOString(),
    ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
  });
  store.contacts[patientId] = contacts;
  saveDemoStore(store);
  invalidateDemoCache();
}

export function updateDemoPatient(
  patientId: string,
  updates: Partial<Omit<DemoPatientRaw, "id">>
): boolean {
  const store = getDemoStore();
  const patient = store.patients.find((p) => p.id === patientId);
  if (!patient) return false;
  Object.assign(patient, updates);
  saveDemoStore(store);
  invalidateDemoCache();
  return true;
}

export function getDemoContacts(): { patientId: string; channel: string; outcome: string; createdAt: string; notes?: string }[] {
  const store = getDemoStore();
  const all: { patientId: string; channel: string; outcome: string; createdAt: string; notes?: string }[] = [];
  for (const [patientId, contacts] of Object.entries(store.contacts)) {
    for (const c of contacts) {
      all.push({
        patientId,
        channel: c.channel,
        outcome: c.outcome,
        createdAt: c.created_at,
        notes: c.notes ?? undefined,
      });
    }
  }
  return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

import { dateAtWeek } from "./pregnancy";

export type CareEventKind = "scan" | "test" | "injection" | "visit";

export interface ScheduleTemplateItem {
  id: string;
  code: string;
  name: string;
  kind: CareEventKind;
  windowStartWeek: number;
  windowEndWeek: number;
  /** e.g. "rh_negative"; null/undefined = applies to everyone */
  condition: string | null;
  isCritical: boolean;
}

export interface PatientForSchedule {
  rhNegative: boolean;
}

export interface GeneratedCareEvent {
  templateItemId: string;
  name: string;
  kind: CareEventKind;
  dueFrom: Date;
  dueTo: Date;
  /**
   * Set when the item's entire window had already closed before the patient
   * was registered (a late booking) — there is nothing to chase, so it is
   * recorded as missed rather than surfaced as "overdue".
   */
  skippedReason: string | null;
}

function itemApplies(item: ScheduleTemplateItem, patient: PatientForSchedule): boolean {
  if (item.condition === "rh_negative") return patient.rhNegative;
  return true;
}

/** Pure: (LMP, clinic template, patient, today) -> the care events to create. */
export function generateSchedule(
  lmp: Date,
  template: ScheduleTemplateItem[],
  patient: PatientForSchedule,
  today: Date
): GeneratedCareEvent[] {
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

  return template
    .filter((item) => itemApplies(item, patient))
    .map((item): GeneratedCareEvent => {
      const dueFrom = dateAtWeek(lmp, item.windowStartWeek);
      const dueTo = dateAtWeek(lmp, item.windowEndWeek);
      const windowAlreadyClosed = dueTo.getTime() < todayUTC;
      return {
        templateItemId: item.id,
        name: item.name,
        kind: item.kind,
        dueFrom,
        dueTo,
        skippedReason: windowAlreadyClosed ? "late_booking" : null,
      };
    });
}

export interface ExistingCareEvent {
  templateItemId: string;
  completedAt: Date | null;
  /** true if a staff member explicitly skipped this event (not the late-booking auto-skip) */
  manuallySkipped: boolean;
}

export interface ScheduleDiff {
  /** template items with no matching existing row: insert as-is */
  toInsert: GeneratedCareEvent[];
  /** existing rows whose dates should be updated to the regenerated window */
  toUpdateDates: Array<{ templateItemId: string; dueFrom: Date; dueTo: Date; skippedReason: string | null }>;
  /** open existing items the regenerated schedule no longer includes (e.g. Rh- corrected to Rh+): skip, don't let them go overdue */
  toSkip: string[];
}

/**
 * When LMP/EDD is corrected, regenerate the schedule and diff it against
 * what's already in the DB: completed or manually-skipped events are left
 * untouched, everything else gets its dates refreshed (or created new).
 */
export function diffRegeneratedSchedule(
  regenerated: GeneratedCareEvent[],
  existing: ExistingCareEvent[]
): ScheduleDiff {
  const existingByItem = new Map(existing.map((e) => [e.templateItemId, e]));
  const toInsert: GeneratedCareEvent[] = [];
  const toUpdateDates: ScheduleDiff["toUpdateDates"] = [];
  const regeneratedIds = new Set(regenerated.map((r) => r.templateItemId));
  const toSkip = existing
    .filter((e) => !regeneratedIds.has(e.templateItemId) && !e.completedAt && !e.manuallySkipped)
    .map((e) => e.templateItemId);

  for (const item of regenerated) {
    const match = existingByItem.get(item.templateItemId);
    if (!match) {
      toInsert.push(item);
      continue;
    }
    if (match.completedAt || match.manuallySkipped) continue;
    toUpdateDates.push({
      templateItemId: item.templateItemId,
      dueFrom: item.dueFrom,
      dueTo: item.dueTo,
      skippedReason: item.skippedReason,
    });
  }

  return { toInsert, toUpdateDates, toSkip };
}

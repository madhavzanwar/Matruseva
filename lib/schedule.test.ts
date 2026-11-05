import { describe, expect, it } from "vitest";
import { generateSchedule, diffRegeneratedSchedule, type ScheduleTemplateItem } from "./schedule";
import { dateAtWeek } from "./pregnancy";

const template: ScheduleTemplateItem[] = [
  { id: "dating_scan", code: "dating_scan", name: "Dating scan", kind: "scan", windowStartWeek: 6, windowEndWeek: 10, condition: null, isCritical: true },
  { id: "nt_scan", code: "nt_scan", name: "NT scan", kind: "scan", windowStartWeek: 11, windowEndWeek: 13.85, condition: null, isCritical: true },
  { id: "anomaly_scan", code: "anomaly_scan", name: "Anomaly scan", kind: "scan", windowStartWeek: 18, windowEndWeek: 22, condition: null, isCritical: true },
  { id: "anti_d", code: "anti_d", name: "Anti-D", kind: "injection", windowStartWeek: 28, windowEndWeek: 28, condition: "rh_negative", isCritical: true },
];

describe("generateSchedule", () => {
  const lmp = new Date(2026, 0, 1);

  it("generates one event per applicable template item, dated from LMP", () => {
    const today = lmp; // registered on day 1
    const events = generateSchedule(lmp, template, { rhNegative: false }, today);

    // anti_d excluded: patient is not Rh negative
    expect(events.map((e) => e.templateItemId)).toEqual(["dating_scan", "nt_scan", "anomaly_scan"]);
    expect(events[0].dueFrom).toEqual(dateAtWeek(lmp, 6));
    expect(events[0].dueTo).toEqual(dateAtWeek(lmp, 10));
    expect(events.every((e) => e.skippedReason === null)).toBe(true);
  });

  it("includes Rh-negative-only items when the patient is Rh negative", () => {
    const today = lmp;
    const events = generateSchedule(lmp, template, { rhNegative: true }, today);
    expect(events.map((e) => e.templateItemId)).toContain("anti_d");
  });

  it("marks windows that fully closed before registration as a late booking, not due", () => {
    // Registering at 20 weeks: dating scan (6-10w) and NT scan (11-13.85w)
    // windows are both fully in the past; anomaly scan (18-22w) is still open.
    const registeredAt20Weeks = dateAtWeek(lmp, 20);
    const events = generateSchedule(lmp, template, { rhNegative: false }, registeredAt20Weeks);

    const byId = Object.fromEntries(events.map((e) => [e.templateItemId, e]));
    expect(byId.dating_scan.skippedReason).toBe("late_booking");
    expect(byId.nt_scan.skippedReason).toBe("late_booking");
    expect(byId.anomaly_scan.skippedReason).toBeNull();
  });
});

describe("diffRegeneratedSchedule", () => {
  const lmp = new Date(2026, 0, 1);
  const regenerated = generateSchedule(lmp, template, { rhNegative: false }, lmp);

  it("inserts events with no existing match", () => {
    const diff = diffRegeneratedSchedule(regenerated, []);
    expect(diff.toInsert.map((e) => e.templateItemId)).toEqual(["dating_scan", "nt_scan", "anomaly_scan"]);
    expect(diff.toUpdateDates).toEqual([]);
  });

  it("leaves completed events untouched but refreshes dates on open ones", () => {
    const existing = [
      { templateItemId: "dating_scan", completedAt: new Date(2026, 1, 10), manuallySkipped: false },
      { templateItemId: "nt_scan", completedAt: null, manuallySkipped: false },
    ];
    const diff = diffRegeneratedSchedule(regenerated, existing);

    expect(diff.toUpdateDates.map((e) => e.templateItemId)).toEqual(["nt_scan"]);
    expect(diff.toInsert.map((e) => e.templateItemId)).toEqual(["anomaly_scan"]);
  });

  it("flags open events no longer in the regenerated schedule to be skipped", () => {
    const existing = [
      { templateItemId: "anti_d", completedAt: null, manuallySkipped: false },
      { templateItemId: "x_done", completedAt: new Date(2026, 1, 10), manuallySkipped: false },
      { templateItemId: "x_manual", completedAt: null, manuallySkipped: true },
    ];
    expect(diffRegeneratedSchedule(regenerated, existing).toSkip).toEqual(["anti_d"]);
  });

  it("carries the regenerated skippedReason so late-booking events are re-dated", () => {
    const late = generateSchedule(lmp, template, { rhNegative: false }, new Date(2026, 6, 1));
    const existing = [{ templateItemId: "dating_scan", completedAt: null, manuallySkipped: false }];
    const upd = diffRegeneratedSchedule(late, existing).toUpdateDates[0];
    expect(upd.skippedReason).toBe("late_booking");
  });

  it("leaves manually-skipped events untouched", () => {
    const existing = [
      { templateItemId: "dating_scan", completedAt: null, manuallySkipped: true },
    ];
    const diff = diffRegeneratedSchedule(regenerated, existing);
    expect(diff.toUpdateDates.find((e) => e.templateItemId === "dating_scan")).toBeUndefined();
  });

  it("recalculates milestone dates when dating scan corrects LMP forward by 2 weeks", () => {
    const correctedLmp = new Date(2026, 0, 15); // +14 days from original Jan 1

    const correctedSchedule = generateSchedule(correctedLmp, template, { rhNegative: false }, correctedLmp);
    const existing = [
      { templateItemId: "dating_scan", completedAt: new Date(2026, 1, 10), manuallySkipped: false }, // completed, should not change
      { templateItemId: "nt_scan", completedAt: null, manuallySkipped: false }, // open, should update
      { templateItemId: "anomaly_scan", completedAt: null, manuallySkipped: false }, // open, should update
    ];

    const diff = diffRegeneratedSchedule(correctedSchedule, existing);
    expect(diff.toInsert).toEqual([]);
    expect(diff.toUpdateDates.length).toBe(2);

    const ntUpdate = diff.toUpdateDates.find((u) => u.templateItemId === "nt_scan");
    expect(ntUpdate?.dueFrom).toEqual(dateAtWeek(correctedLmp, 11));
    expect(ntUpdate?.dueTo).toEqual(dateAtWeek(correctedLmp, 13.85));

    const anomalyUpdate = diff.toUpdateDates.find((u) => u.templateItemId === "anomaly_scan");
    expect(anomalyUpdate?.dueFrom).toEqual(dateAtWeek(correctedLmp, 18));
    expect(anomalyUpdate?.dueTo).toEqual(dateAtWeek(correctedLmp, 22));
  });

  it("inserts newly applicable milestones when patient is updated to Rh negative", () => {
    const lmpDate = new Date(2026, 0, 1);
    // Previously Rh positive (anti_d excluded)
    const existing = [
      { templateItemId: "dating_scan", completedAt: null, manuallySkipped: false },
      { templateItemId: "nt_scan", completedAt: null, manuallySkipped: false },
      { templateItemId: "anomaly_scan", completedAt: null, manuallySkipped: false },
    ];

    // Updated to Rh negative (anti_d now applicable)
    const updatedSchedule = generateSchedule(lmpDate, template, { rhNegative: true }, lmpDate);
    const diff = diffRegeneratedSchedule(updatedSchedule, existing);

    expect(diff.toInsert.map((e) => e.templateItemId)).toEqual(["anti_d"]);
    expect(diff.toInsert[0].name).toBe("Anti-D");
  });
});


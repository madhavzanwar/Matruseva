import { describe, it, expect } from "vitest";
import { makeTranslator } from "@/lib/i18n/translate";
import { addDemoPatient, getDemoPatientDetail } from "./demo-data";
import { getPatientObstetricData } from "./obstetricReportData";
import { localizeRiskFlags, questionnaireFromFormFields, type ObstetricQuestionnaireData } from "./obstetricQuestionnaire";

const en = makeTranslator("en");
const hi = makeTranslator("hi");

const highRisk: ObstetricQuestionnaireData = {
  previousDeliveryMode: "LSCS",
  priorComplications: ["preeclampsia"],
  pastPregnancyLoss: "2+",
  pastBirthWeight: "low",
  interpregnancyInterval: "<18m",
  familyComplications: ["diabetes"],
  chronicConditions: ["cardiac"],
};

describe("getPatientObstetricData with a registration questionnaire", () => {
  it("keeps the existing generated history for patients without a questionnaire", () => {
    const withNull = getPatientObstetricData("p-new", "New Patient", 3, 2, false, null);
    const without = getPatientObstetricData("p-new", "New Patient", 3, 2, false);
    expect(withNull).toEqual(without);
    expect(without.questionnaireRiskFlags).toEqual([]);
    expect(without.pastHistory.previousDeliveryMode).toBe("NVD");
    expect(without.pastHistory.pastMiscarriages).toBe(0);
    expect(without.pastHistory.notes).toContain("Multigravida (G3P2)");
    expect(without.scans.length).toBeGreaterThan(0);
  });

  it("keeps the curated history of the built-in demo patients", () => {
    const pooja = getPatientObstetricData("p1-pooja-deshmukh", "Pooja Deshmukh", 2, 1);
    expect(pooja.questionnaireRiskFlags).toEqual([]);
    expect(pooja.scans.length).toBeGreaterThan(0);
  });

  it("uses the questionnaire for history and flag codes, and keeps the generated scans", () => {
    const withQ = getPatientObstetricData("p-new", "New Patient", 3, 1, false, { answers: highRisk, t: en });
    const generated = getPatientObstetricData("p-new", "New Patient", 3, 1, false);
    expect(withQ.pastHistory).toMatchObject({ previousDeliveryMode: "LSCS", pastPreEclampsia: true, pastMiscarriages: 2, pastLowBirthWeight: true });
    expect(withQ.scans).toEqual(generated.scans);
    expect(withQ.questionnaireRiskFlags).toEqual([
      "prev_lscs",
      "prior_preeclampsia",
      "recurrent_pregnancy_loss",
      "prior_low_birth_weight",
      "short_interval_post_lscs",
      "cardiac_disease",
    ]);
  });

  it("the flags are shown localised, not as English sentences", () => {
    const { questionnaireRiskFlags } = getPatientObstetricData("p-new", "New Patient", 3, 1, false, { answers: highRisk, t: hi });
    const labels = localizeRiskFlags(questionnaireRiskFlags, hi);
    expect(labels).toHaveLength(questionnaireRiskFlags.length);
    for (const label of labels) expect(label).toMatch(/[ऀ-ॿ]/);
    expect(localizeRiskFlags(questionnaireRiskFlags, en)[0]).toBe("Previous LSCS (scar monitoring)");
  });

  it("re-validates stored answers (the JSON store is untrusted)", () => {
    const stale = {
      previousDeliveryMode: "Primi",
      priorComplications: ["preeclampsia", "pph"],
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
    };
    const data = getPatientObstetricData("p-new", "New Patient", 1, 0, false, { answers: stale, t: en });
    expect(data.questionnaireRiskFlags).toEqual([]);
    expect(data.pastHistory).toMatchObject({ pastPreEclampsia: false, pastPPH: false, pastLowBirthWeight: false });
    const garbage = getPatientObstetricData("p-new", "New Patient", 1, 0, false, { answers: "not an object", t: en });
    expect(garbage.questionnaireRiskFlags).toEqual([]);
  });
});

describe("demo store round trip", () => {
  it("stores the normalised questionnaire and returns it with the patient detail", () => {
    const questionnaire = questionnaireFromFormFields({
      q_previousDeliveryMode: "Primi",
      q_priorComplications: '["preeclampsia"]', // tampered: hidden for Primi
      q_pastPregnancyLoss: "1",
      q_chronicConditions: '["thyroid"]',
      q_doctorNotes: "  checked\u0000 ",
    });
    expect(questionnaire).toBeDefined();
    const id = addDemoPatient({ name: "Questionnaire Test Primi", lmp: "2026-09-01", rhNegative: false, obstetricQuestionnaire: questionnaire });

    const stored = getDemoPatientDetail(id).patient.obstetricQuestionnaire;
    expect(stored).toMatchObject({
      previousDeliveryMode: "Primi",
      priorComplications: ["none"],
      pastPregnancyLoss: "1",
      chronicConditions: ["thyroid"],
      doctorNotes: "checked",
    });

    const report = getPatientObstetricData(id, "Questionnaire Test Primi", 1, 0, false, { answers: stored, t: en });
    expect(report.questionnaireRiskFlags).toEqual(["thyroid_disorder"]);
    expect(report.pastHistory.pastMiscarriages).toBe(1);
  });

  it("patients registered without a questionnaire have none", () => {
    const id = addDemoPatient({ name: "Questionnaire Test None", lmp: "2026-09-01", rhNegative: false });
    expect(getDemoPatientDetail(id).patient.obstetricQuestionnaire).toBeNull();
  });
});

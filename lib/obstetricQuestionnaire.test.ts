import { describe, it, expect } from "vitest";
import { makeTranslator } from "@/lib/i18n/translate";
import { messages } from "@/lib/i18n/messages";
import { LOCALES } from "@/lib/i18n/config";
import {
  CHRONIC_CONDITIONS,
  createDefaultQuestionnaire,
  DEFAULT_OBSTETRIC_QUESTIONNAIRE,
  deriveRiskFlags,
  DOCTOR_NOTES_MAX,
  FAMILY_COMPLICATIONS,
  getVisibleQuestions,
  isAlertOption,
  localizeRiskFlags,
  normalizeQuestionnaire,
  parseJsonArrayField,
  PRIOR_COMPLICATIONS,
  QUESTIONS,
  questionNumber,
  questionnaireFieldName,
  questionnaireFormFields,
  questionnaireFromFormFields,
  questionnaireToObstetricReport,
  resetHiddenAnswers,
  RISK_FLAG_CODES,
  RISK_FLAG_LABEL_KEYS,
  sanitizeDoctorNotes,
  setAnswer,
  toggleAnswer,
  type DeliveryMode,
  type ObstetricQuestionnaireData,
} from "./obstetricQuestionnaire";

const en = makeTranslator("en");

function answersFor(mode: DeliveryMode, overrides: Partial<ObstetricQuestionnaireData> = {}): ObstetricQuestionnaireData {
  return { ...createDefaultQuestionnaire(), previousDeliveryMode: mode, ...overrides };
}

const idsOf = (a: ObstetricQuestionnaireData) => getVisibleQuestions(a).map((q) => q.id);

/** Keys that exist in a locale's catalogue, counting plural variants (`key_one` / `key_other`) as the base key. */
function hasKey(locale: (typeof LOCALES)[number], key: string): boolean {
  const dict = messages[locale];
  return dict[key] !== undefined || dict[`${key}_other`] !== undefined;
}

describe("question list and numbering", () => {
  it("lists the seven questions in order", () => {
    expect(QUESTIONS.map((q) => q.id)).toEqual([
      "previousDeliveryMode",
      "priorComplications",
      "pastPregnancyLoss",
      "pastBirthWeight",
      "interpregnancyInterval",
      "familyComplications",
      "chronicConditions",
    ]);
  });

  it("shows four questions to a primigravida and numbers them 1-4", () => {
    const a = answersFor("Primi");
    expect(idsOf(a)).toEqual(["previousDeliveryMode", "pastPregnancyLoss", "familyComplications", "chronicConditions"]);
    // Exactly what the form renders: the number is the index in the visible list.
    expect(getVisibleQuestions(a).map((q, i) => [q.id, i + 1])).toEqual([
      ["previousDeliveryMode", 1],
      ["pastPregnancyLoss", 2],
      ["familyComplications", 3],
      ["chronicConditions", 4],
    ]);
  });

  it.each(["NVD", "LSCS", "Instrumental"] as const)("shows all seven questions for %s, numbered 1-7", (mode) => {
    const a = answersFor(mode);
    expect(idsOf(a)).toEqual(QUESTIONS.map((q) => q.id));
    expect(QUESTIONS.map((q) => questionNumber(a, q.id))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("questionNumber is the position in the visible list, or null when hidden", () => {
    const primi = answersFor("Primi");
    expect(questionNumber(primi, "previousDeliveryMode")).toBe(1);
    expect(questionNumber(primi, "pastPregnancyLoss")).toBe(2);
    expect(questionNumber(primi, "familyComplications")).toBe(3);
    expect(questionNumber(primi, "chronicConditions")).toBe(4);
    for (const hidden of ["priorComplications", "pastBirthWeight", "interpregnancyInterval"] as const) {
      expect(questionNumber(primi, hidden)).toBeNull();
    }
    const lscs = answersFor("LSCS");
    expect(questionNumber(lscs, "familyComplications")).toBe(6);
    expect(questionNumber(lscs, "chronicConditions")).toBe(7);
  });

  it("numbers are always contiguous from 1, whatever the delivery mode", () => {
    for (const mode of ["Primi", "NVD", "LSCS", "Instrumental"] as const) {
      const a = answersFor(mode);
      const numbers = getVisibleQuestions(a).map((q) => questionNumber(a, q.id));
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
  });

  it("only prior complications, birth weight and interval depend on the delivery mode", () => {
    const conditional = QUESTIONS.filter((q) => q.visible(answersFor("Primi")) !== q.visible(answersFor("NVD"))).map((q) => q.id);
    expect(conditional).toEqual(["priorComplications", "pastBirthWeight", "interpregnancyInterval"]);
  });

  it("every question has options with unique ids, and single/multi kinds are consistent", () => {
    for (const q of QUESTIONS) {
      const ids = q.options.map((o) => o.id);
      expect(new Set(ids).size, q.id).toBe(ids.length);
      expect(q.options.length, q.id).toBeGreaterThan(1);
      if (q.kind === "multi") expect(ids, q.id).toContain("none");
    }
  });

  it("the short-interval option is an alert only after a caesarean", () => {
    const short = QUESTIONS.find((q) => q.id === "interpregnancyInterval")!.options.find((o) => o.id === "<18m")!;
    expect(isAlertOption(short, answersFor("LSCS"))).toBe(true);
    expect(isAlertOption(short, answersFor("NVD"))).toBe(false);
  });
});

describe("answer updates used by the form", () => {
  it("switching away from Primi preselects sensible defaults for the newly shown questions", () => {
    const next = setAnswer(answersFor("Primi"), "previousDeliveryMode", "NVD");
    expect(next.previousDeliveryMode).toBe("NVD");
    expect(next.priorComplications).toEqual(["none"]);
    expect(next.pastBirthWeight).toBe("normal");
    expect(next.interpregnancyInterval).toBe("18m-5y");
  });

  it("switching to Primi resets the hidden answers so they are not submitted", () => {
    let a = setAnswer(answersFor("Primi"), "previousDeliveryMode", "LSCS");
    a = toggleAnswer(a, "priorComplications", "preeclampsia");
    a = setAnswer(a, "pastBirthWeight", "low");
    a = setAnswer(a, "interpregnancyInterval", "<18m");
    expect(a.priorComplications).toEqual(["preeclampsia"]);

    a = setAnswer(a, "previousDeliveryMode", "Primi");
    expect(a.priorComplications).toEqual(["none"]);
    expect(a.pastBirthWeight).toBe("na");
    expect(a.interpregnancyInterval).toBe("na");
    expect(idsOf(a)).toHaveLength(4);
    // Answers to always-visible questions survive the switch.
    expect(a.pastPregnancyLoss).toBe("0");
  });

  it("keeps answers when switching between two non-Primi modes", () => {
    let a = setAnswer(answersFor("Primi"), "previousDeliveryMode", "NVD");
    a = toggleAnswer(a, "priorComplications", "gdm");
    a = setAnswer(a, "pastBirthWeight", "high");
    a = setAnswer(a, "previousDeliveryMode", "LSCS");
    expect(a.priorComplications).toEqual(["gdm"]);
    expect(a.pastBirthWeight).toBe("high");
  });

  it("the question count follows the delivery mode (4 -> 7 -> 4)", () => {
    let a = answersFor("Primi");
    expect(getVisibleQuestions(a)).toHaveLength(4);
    a = setAnswer(a, "previousDeliveryMode", "Instrumental");
    expect(getVisibleQuestions(a)).toHaveLength(7);
    a = setAnswer(a, "previousDeliveryMode", "Primi");
    expect(getVisibleQuestions(a)).toHaveLength(4);
  });

  it("'none' is exclusive when toggling", () => {
    let a = answersFor("NVD");
    a = toggleAnswer(a, "priorComplications", "pph");
    a = toggleAnswer(a, "priorComplications", "gdm");
    expect(a.priorComplications).toEqual(["pph", "gdm"]);
    a = toggleAnswer(a, "priorComplications", "none");
    expect(a.priorComplications).toEqual(["none"]);
    a = toggleAnswer(a, "priorComplications", "gdm");
    expect(a.priorComplications).toEqual(["gdm"]);
    // Un-ticking the last choice falls back to "none".
    a = toggleAnswer(a, "priorComplications", "gdm");
    expect(a.priorComplications).toEqual(["none"]);
  });

  it("ignores options that do not belong to the question and wrong-kind updates", () => {
    const a = answersFor("NVD");
    expect(setAnswer(a, "pastPregnancyLoss", "bogus")).toBe(a);
    expect(setAnswer(a, "priorComplications", "pph")).toBe(a); // multi question
    expect(toggleAnswer(a, "pastPregnancyLoss", "1")).toBe(a); // single question
    expect(toggleAnswer(a, "chronicConditions", "bogus")).toBe(a);
  });

  it("does not mutate its input", () => {
    const a = answersFor("LSCS", { priorComplications: ["pph"] });
    const snapshot = JSON.stringify(a);
    toggleAnswer(a, "priorComplications", "gdm");
    setAnswer(a, "previousDeliveryMode", "Primi");
    expect(JSON.stringify(a)).toBe(snapshot);
  });

  it("resetHiddenAnswers leaves a fully visible questionnaire untouched", () => {
    const a = answersFor("NVD", { priorComplications: ["pph"], pastBirthWeight: "low" });
    expect(resetHiddenAnswers(a)).toEqual(a);
  });
});

describe("normalizeQuestionnaire", () => {
  it("resets hidden answers to their defaults for a primigravida", () => {
    const n = normalizeQuestionnaire({
      previousDeliveryMode: "Primi",
      priorComplications: ["preeclampsia", "pph"],
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
    });
    expect(n.priorComplications).toEqual(["none"]);
    expect(n.pastBirthWeight).toBe("na");
    expect(n.interpregnancyInterval).toBe("na");
  });

  it("keeps the answers of a multigravida", () => {
    const n = normalizeQuestionnaire({
      previousDeliveryMode: "LSCS",
      priorComplications: ["preeclampsia"],
      pastPregnancyLoss: "2+",
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
      familyComplications: ["twins"],
      chronicConditions: ["thyroid"],
      doctorNotes: "Elective repeat LSCS.",
    });
    expect(n).toEqual({
      previousDeliveryMode: "LSCS",
      priorComplications: ["preeclampsia"],
      pastPregnancyLoss: "2+",
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
      familyComplications: ["twins"],
      chronicConditions: ["thyroid"],
      doctorNotes: "Elective repeat LSCS.",
    });
  });

  it("falls back to the defaults for missing or non-object input, never throwing", () => {
    for (const raw of [undefined, null, "", "x", 42, true, [], ["LSCS"], () => 1, Symbol("s")]) {
      expect(normalizeQuestionnaire(raw), String(typeof raw)).toEqual(createDefaultQuestionnaire());
    }
    expect(normalizeQuestionnaire({})).toEqual(createDefaultQuestionnaire());
  });

  it("drops unknown ids and invalid values field by field, keeping the valid ones", () => {
    const n = normalizeQuestionnaire({
      previousDeliveryMode: "Helicopter",
      priorComplications: ["pph", "<script>", "PPH", 7, null, { id: "gdm" }, "toString", "__proto__", "constructor"],
      pastPregnancyLoss: "many",
      pastBirthWeight: 3,
      interpregnancyInterval: "forever",
      familyComplications: "diabetes", // not an array
      chronicConditions: ["thyroid", "unknown"],
      doctorNotes: { not: "a string" },
      extra: "ignored",
    });
    expect(n.previousDeliveryMode).toBe("Primi"); // invalid -> default
    expect(n.pastPregnancyLoss).toBe("0");
    expect(n.pastBirthWeight).toBe("na");
    expect(n.interpregnancyInterval).toBe("na");
    expect(n.familyComplications).toEqual(["none"]);
    expect(n.chronicConditions).toEqual(["thyroid"]);
    expect(n.doctorNotes).toBe("");
    expect(Object.keys(n).sort()).toEqual(
      [
        "chronicConditions",
        "doctorNotes",
        "familyComplications",
        "interpregnancyInterval",
        "pastBirthWeight",
        "pastPregnancyLoss",
        "previousDeliveryMode",
        "priorComplications",
      ].sort(),
    );
    // For a multigravida the same junk only loses the junk.
    const m = normalizeQuestionnaire({ previousDeliveryMode: "NVD", priorComplications: ["pph", "<script>", "PPH", 7, "__proto__"] });
    expect(m.priorComplications).toEqual(["pph"]);
  });

  it("does not let prototype-pollution payloads through", () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"previousDeliveryMode":"NVD"}');
    const n = normalizeQuestionnaire(polluted);
    expect(n.previousDeliveryMode).toBe("NVD");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((n as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  describe("'none' exclusivity", () => {
    it("a real choice wins over a stray 'none' (a risk is never hidden)", () => {
      expect(normalizeQuestionnaire({ previousDeliveryMode: "NVD", priorComplications: ["none", "pph"] }).priorComplications).toEqual(["pph"]);
      expect(normalizeQuestionnaire({ familyComplications: ["none", "twins", "diabetes"] }).familyComplications).toEqual(["diabetes", "twins"]);
      expect(normalizeQuestionnaire({ chronicConditions: ["cardiac", "none"] }).chronicConditions).toEqual(["cardiac"]);
    });

    it("an empty, unknown-only or 'none'-only list is exactly ['none']", () => {
      for (const list of [[], ["none"], ["none", "none"], ["bogus"], ["bogus", "none"]]) {
        expect(normalizeQuestionnaire({ familyComplications: list }).familyComplications).toEqual(["none"]);
      }
    });

    it("de-duplicates and orders choices canonically", () => {
      expect(normalizeQuestionnaire({ chronicConditions: ["cardiac", "hypertension", "cardiac"] }).chronicConditions).toEqual([
        "hypertension",
        "cardiac",
      ]);
    });
  });

  describe("doctor notes", () => {
    it("caps the length at 500 characters", () => {
      expect(normalizeQuestionnaire({ doctorNotes: "a".repeat(5000) }).doctorNotes).toHaveLength(DOCTOR_NOTES_MAX);
      expect(DOCTOR_NOTES_MAX).toBe(500);
    });

    it("strips control characters and collapses whitespace", () => {
      expect(sanitizeDoctorNotes("Scar\u0000 tender\u0007ness\r\n  checked\t.")).toBe("Scar tender ness checked .");
      expect(sanitizeDoctorNotes("  padded  ")).toBe("padded");
      expect(sanitizeDoctorNotes("\u0000\u0001\u001f\u007f\u0085")).toBe("");
    });

    it("strips bidirectional overrides but keeps Devanagari and joiners", () => {
      expect(sanitizeDoctorNotes("a‮b⁦c⁩d")).toBe("a b c d");
      const marathi = "क्‍ष स्कार तपासला";
      expect(sanitizeDoctorNotes(marathi)).toBe(marathi);
    });

    it("never cuts a surrogate pair in half when capping", () => {
      const emoji = "\u{1F600}".repeat(DOCTOR_NOTES_MAX + 10);
      const out = sanitizeDoctorNotes(emoji);
      expect(Array.from(out)).toHaveLength(DOCTOR_NOTES_MAX);
      expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    });

    it("treats non-strings as empty", () => {
      expect(normalizeQuestionnaire({ doctorNotes: 12345 }).doctorNotes).toBe("");
    });
  });

  it("is idempotent and does not mutate its input", () => {
    const raw = { previousDeliveryMode: "Primi", priorComplications: ["pph", "none"], doctorNotes: "  hi  " };
    const frozen = JSON.stringify(raw);
    const once = normalizeQuestionnaire(raw);
    expect(JSON.stringify(raw)).toBe(frozen);
    expect(normalizeQuestionnaire(once)).toEqual(once);
  });

  it("DEFAULT_OBSTETRIC_QUESTIONNAIRE is a frozen primigravida with nothing to report", () => {
    expect(DEFAULT_OBSTETRIC_QUESTIONNAIRE).toEqual(createDefaultQuestionnaire());
    expect(Object.isFrozen(DEFAULT_OBSTETRIC_QUESTIONNAIRE)).toBe(true);
    expect(createDefaultQuestionnaire()).not.toBe(createDefaultQuestionnaire());
    expect(createDefaultQuestionnaire().priorComplications).not.toBe(createDefaultQuestionnaire().priorComplications);
  });

  it("option ids of every question match the whitelist the schema accepts", () => {
    const accepted: Record<string, readonly string[]> = {
      priorComplications: PRIOR_COMPLICATIONS,
      familyComplications: FAMILY_COMPLICATIONS,
      chronicConditions: CHRONIC_CONDITIONS,
    };
    for (const q of QUESTIONS.filter((x) => x.kind === "multi")) {
      expect(q.options.map((o) => o.id)).toEqual(accepted[q.id]);
    }
    // Every offered single-choice option survives normalisation for a multigravida.
    for (const q of QUESTIONS.filter((x) => x.kind === "single")) {
      for (const o of q.options) {
        const n = normalizeQuestionnaire({ previousDeliveryMode: "NVD", [q.id]: o.id });
        expect(n[q.id], `${q.id}=${o.id}`).toBe(o.id);
      }
    }
  });
});

describe("form transport (what the action receives)", () => {
  const fieldsRecord = (answers: unknown) => Object.fromEntries(questionnaireFormFields(answers).map((f) => [f.name, f.value]));

  it("does not submit hidden questions for a primigravida", () => {
    const stale = answersFor("Primi", { priorComplications: ["preeclampsia"], pastBirthWeight: "low", interpregnancyInterval: "<18m" });
    const fields = fieldsRecord(stale);
    expect(Object.keys(fields).sort()).toEqual(
      ["q_chronicConditions", "q_doctorNotes", "q_familyComplications", "q_pastPregnancyLoss", "q_previousDeliveryMode"].sort(),
    );
    expect(JSON.stringify(fields)).not.toContain("preeclampsia");
  });

  it("submits every question for a multigravida, arrays as JSON", () => {
    const fields = fieldsRecord(answersFor("LSCS", { priorComplications: ["pph", "gdm"], pastBirthWeight: "high" }));
    expect(Object.keys(fields)).toHaveLength(8);
    expect(JSON.parse(fields.q_priorComplications)).toEqual(["gdm", "pph"]);
    expect(fields.q_pastBirthWeight).toBe("high");
    expect(fields.q_previousDeliveryMode).toBe("LSCS");
  });

  it("round-trips through the server-side parser to the normalised answers", () => {
    for (const mode of ["Primi", "NVD", "LSCS", "Instrumental"] as const) {
      const a = answersFor(mode, { priorComplications: ["gdm"], familyComplications: ["twins"], doctorNotes: "  note  " });
      expect(questionnaireFromFormFields(fieldsRecord(a))).toEqual(normalizeQuestionnaire(a));
    }
  });

  it("uses the q_ prefixed field names", () => {
    expect(questionnaireFieldName("previousDeliveryMode")).toBe("q_previousDeliveryMode");
    expect(questionnaireFieldName("doctorNotes")).toBe("q_doctorNotes");
  });

  it("returns undefined when the form did not include the questionnaire", () => {
    expect(questionnaireFromFormFields({})).toBeUndefined();
    expect(questionnaireFromFormFields({ name: "Asha", q_priorComplications: '["pph"]' })).toBeUndefined();
    expect(questionnaireFromFormFields({ q_previousDeliveryMode: "  " })).toBeUndefined();
    expect(questionnaireFromFormFields({ q_previousDeliveryMode: 5 })).toBeUndefined();
  });

  it("never throws on malformed JSON or odd field types", () => {
    const hostile = [
      "{not json",
      "[",
      '["pph"',
      "null",
      "42",
      '"pph"',
      '{"a":1}',
      "undefined",
      "",
      "x".repeat(100_000),
      new File(["x"], "evil.txt"),
      { toString: () => "boom" },
      12,
      null,
      undefined,
    ];
    for (const bad of hostile) {
      const q = questionnaireFromFormFields({
        q_previousDeliveryMode: "NVD",
        q_priorComplications: bad,
        q_familyComplications: bad,
        q_chronicConditions: bad,
        q_pastPregnancyLoss: bad,
        q_pastBirthWeight: bad,
        q_interpregnancyInterval: bad,
        q_doctorNotes: bad,
      });
      expect(q).toBeDefined();
      expect(q!.priorComplications).toEqual(["none"]);
      expect(q!.familyComplications).toEqual(["none"]);
      expect(q!.chronicConditions).toEqual(["none"]);
    }
  });

  it("keeps the valid parts when only one field is malformed", () => {
    const q = questionnaireFromFormFields({
      q_previousDeliveryMode: "LSCS",
      q_priorComplications: "{oops",
      q_familyComplications: '["diabetes"]',
      q_chronicConditions: '["cardiac","nonsense"]',
      q_pastPregnancyLoss: "stillbirth",
    });
    expect(q).toMatchObject({
      previousDeliveryMode: "LSCS",
      priorComplications: ["none"],
      familyComplications: ["diabetes"],
      chronicConditions: ["cardiac"],
      pastPregnancyLoss: "stillbirth",
    });
  });

  it("a tampered Primi submission with prior-delivery fields is reset", () => {
    const q = questionnaireFromFormFields({
      q_previousDeliveryMode: "Primi",
      q_priorComplications: '["preeclampsia","pph"]',
      q_pastBirthWeight: "low",
      q_interpregnancyInterval: "<18m",
    });
    expect(q).toMatchObject({ priorComplications: ["none"], pastBirthWeight: "na", interpregnancyInterval: "na" });
    expect(deriveRiskFlags(q)).toEqual([]);
  });

  it("parseJsonArrayField only ever returns arrays", () => {
    expect(parseJsonArrayField('["a","b"]')).toEqual(["a", "b"]);
    expect(parseJsonArrayField(["a"])).toEqual(["a"]);
    expect(parseJsonArrayField("{}")).toEqual([]);
    expect(parseJsonArrayField("nope")).toEqual([]);
    expect(parseJsonArrayField(undefined)).toEqual([]);
  });
});

describe("risk flag codes", () => {
  const everything: ObstetricQuestionnaireData = {
    previousDeliveryMode: "LSCS",
    priorComplications: ["preeclampsia", "gdm", "pph", "preterm"],
    pastPregnancyLoss: "2+",
    pastBirthWeight: "low",
    interpregnancyInterval: "<18m",
    familyComplications: ["none"],
    chronicConditions: ["hypertension", "thyroid", "cardiac"],
  };

  it("derives stable codes, in a stable order", () => {
    expect(deriveRiskFlags(everything)).toEqual([
      "prev_lscs",
      "prior_preeclampsia",
      "prior_gdm",
      "prior_pph",
      "prior_preterm",
      "recurrent_pregnancy_loss",
      "prior_low_birth_weight",
      "short_interval_post_lscs",
      "chronic_hypertension",
      "thyroid_disorder",
      "cardiac_disease",
    ]);
    expect(deriveRiskFlags({ ...everything, pastPregnancyLoss: "stillbirth" })).toContain("prior_stillbirth");
  });

  it("every flag code can be produced", () => {
    const produced = new Set([...deriveRiskFlags(everything), ...deriveRiskFlags({ ...everything, pastPregnancyLoss: "stillbirth" })]);
    expect([...produced].sort()).toEqual([...RISK_FLAG_CODES].sort());
  });

  it("a short interval is only a flag after a caesarean", () => {
    expect(deriveRiskFlags(answersFor("NVD", { interpregnancyInterval: "<18m" }))).toEqual([]);
    expect(deriveRiskFlags(answersFor("LSCS", { interpregnancyInterval: "<18m" }))).toEqual(["prev_lscs", "short_interval_post_lscs"]);
  });

  it("never derives flags from hidden answers (the Primi bug)", () => {
    // Tick pre-eclampsia under a prior delivery, then switch back to Primi in the UI...
    let a = setAnswer(answersFor("Primi"), "previousDeliveryMode", "NVD");
    a = toggleAnswer(a, "priorComplications", "preeclampsia");
    a = toggleAnswer(a, "priorComplications", "pph");
    a = setAnswer(a, "pastBirthWeight", "low");
    expect(deriveRiskFlags(a)).toEqual(["prior_preeclampsia", "prior_pph", "prior_low_birth_weight"]);
    a = setAnswer(a, "previousDeliveryMode", "Primi");
    expect(deriveRiskFlags(a)).toEqual([]);

    // ...and even a stale object that skipped the UI reset is cleaned by normalisation.
    const stale: ObstetricQuestionnaireData = answersFor("Primi", {
      priorComplications: ["preeclampsia", "pph"],
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
    });
    expect(deriveRiskFlags(stale)).toEqual([]);
    const report = questionnaireToObstetricReport(stale, 1, 0, en);
    expect(report.derivedRiskFlags).toEqual([]);
    expect(report.pastHistory).toMatchObject({ pastPreEclampsia: false, pastPPH: false, pastLowBirthWeight: false, interPregnancyMonths: null });
  });

  it("flags from always-visible questions still apply to a primigravida", () => {
    const flags = deriveRiskFlags(answersFor("Primi", { pastPregnancyLoss: "stillbirth", chronicConditions: ["cardiac"] }));
    expect(flags).toEqual(["prior_stillbirth", "cardiac_disease"]);
  });

  it("is derived from normalised input, so junk cannot create a flag", () => {
    expect(deriveRiskFlags({ priorComplications: ["preeclampsia"], previousDeliveryMode: "Bogus" })).toEqual([]);
    expect(deriveRiskFlags(null)).toEqual([]);
  });
});

describe("questionnaireToObstetricReport (ported reference tests)", () => {
  it("correctly converts primigravida default answers", () => {
    const primiData: ObstetricQuestionnaireData = {
      previousDeliveryMode: "Primi",
      priorComplications: ["none"],
      pastPregnancyLoss: "0",
      pastBirthWeight: "na",
      interpregnancyInterval: "na",
      familyComplications: ["none"],
      chronicConditions: ["none"],
    };

    const res = questionnaireToObstetricReport(primiData, 1, 0, en);
    expect(res.pastHistory.previousDeliveryMode).toBe("None (Primi)");
    expect(res.pastHistory.pastPreEclampsia).toBe(false);
    expect(res.pastHistory.pastMiscarriages).toBe(0);
    expect(res.familyHistory.familyPreEclampsia).toBe(false);
    expect(res.derivedRiskFlags.length).toBe(0);
  });

  it("correctly flags previous LSCS and prior pre-eclampsia", () => {
    const highRiskData: ObstetricQuestionnaireData = {
      previousDeliveryMode: "LSCS",
      priorComplications: ["preeclampsia", "pph"],
      pastPregnancyLoss: "2+",
      pastBirthWeight: "low",
      interpregnancyInterval: "<18m",
      familyComplications: ["diabetes", "preeclampsia"],
      chronicConditions: ["hypertension"],
      doctorNotes: "Advising elective repeat LSCS.",
    };

    const res = questionnaireToObstetricReport(highRiskData, 3, 1, en);
    expect(res.pastHistory.previousDeliveryMode).toBe("LSCS");
    expect(res.pastHistory.pastPreEclampsia).toBe(true);
    expect(res.pastHistory.pastPPH).toBe(true);
    expect(res.pastHistory.pastMiscarriages).toBe(2);
    expect(res.pastHistory.pastLowBirthWeight).toBe(true);
    expect(res.familyHistory.familyPreEclampsia).toBe(true);
    expect(res.familyHistory.familyDiabetes).toBe(true);

    // The reference asserted English sentences; the report now returns stable codes.
    expect(res.derivedRiskFlags).toContain("prev_lscs");
    expect(res.derivedRiskFlags).toContain("prior_preeclampsia");
    expect(res.derivedRiskFlags).toContain("prior_pph");
    expect(res.derivedRiskFlags).toContain("recurrent_pregnancy_loss");
    expect(res.derivedRiskFlags).toContain("short_interval_post_lscs");
    expect(res.derivedRiskFlags).toContain("chronic_hypertension");
  });
});

describe("questionnaireToObstetricReport details", () => {
  it("maps delivery mode, interval bands and loss to the report shape", () => {
    const r = (a: Partial<ObstetricQuestionnaireData>) => questionnaireToObstetricReport({ previousDeliveryMode: "NVD", ...a }, 2, 1, en).pastHistory;
    expect(r({ previousDeliveryMode: "Instrumental" }).previousDeliveryMode).toBe("Assisted (Forceps/Vacuum)");
    expect(r({ interpregnancyInterval: "<18m" }).interPregnancyMonths).toBe(12);
    expect(r({ interpregnancyInterval: "18m-5y" }).interPregnancyMonths).toBe(36);
    expect(r({ interpregnancyInterval: ">5y" }).interPregnancyMonths).toBe(60);
    expect(r({ interpregnancyInterval: "na" }).interPregnancyMonths).toBeNull();
    expect(r({ pastPregnancyLoss: "1" })).toMatchObject({ pastMiscarriages: 1, pastStillbirths: 0 });
    expect(r({ pastPregnancyLoss: "stillbirth" })).toMatchObject({ pastMiscarriages: 0, pastStillbirths: 1 });
  });

  it("an unanswered interval for a primigravida is null, not an invented 60 months", () => {
    expect(questionnaireToObstetricReport(createDefaultQuestionnaire(), 1, 0, en).pastHistory.interPregnancyMonths).toBeNull();
  });

  it("maps family answers, including hereditary anaemia to the genetic flag", () => {
    const { familyHistory } = questionnaireToObstetricReport({ familyComplications: ["anemia", "twins"] }, 1, 0, en);
    expect(familyHistory).toMatchObject({
      familyGeneticAnomalies: true,
      familyTwins: true,
      familyPreEclampsia: false,
      familyHypertension: false,
      familyDiabetes: false,
    });
  });

  it("writes the notes from the answers, in English", () => {
    const { pastHistory, familyHistory } = questionnaireToObstetricReport(
      {
        previousDeliveryMode: "LSCS",
        priorComplications: ["pph"],
        chronicConditions: ["thyroid", "asthma_epilepsy"],
        familyComplications: ["diabetes"],
        doctorNotes: "Advise ASA 75 mg.",
      },
      3,
      1,
      en,
    );
    expect(pastHistory.notes).toContain("Multigravida (G3P1)");
    expect(pastHistory.notes).toContain("Caesarean section (LSCS)");
    expect(pastHistory.notes).toContain("Severe bleeding (PPH)");
    // Chronic conditions without a risk flag (asthma / epilepsy) still reach the report.
    expect(pastHistory.notes).toContain("Asthma / epilepsy");
    expect(pastHistory.notes).toContain("Clinician note: Advise ASA 75 mg.");
    expect(familyHistory.notes).toContain("Family diabetes / GDM");
  });

  it("uses the no-risk family note when nothing is reported", () => {
    expect(questionnaireToObstetricReport({}, 1, 0, en).familyHistory.notes).toMatch(/^No reported first-degree family history/);
  });

  it("writes the notes in the viewer's language", () => {
    for (const locale of ["hi", "mr"] as const) {
      const t = makeTranslator(locale);
      const { pastHistory, familyHistory } = questionnaireToObstetricReport(
        { previousDeliveryMode: "NVD", priorComplications: ["gdm"], familyComplications: ["twins"], doctorNotes: "note" },
        2,
        1,
        t,
      );
      const english = questionnaireToObstetricReport(
        { previousDeliveryMode: "NVD", priorComplications: ["gdm"], familyComplications: ["twins"], doctorNotes: "note" },
        2,
        1,
        en,
      );
      expect(pastHistory.notes).not.toBe(english.pastHistory.notes);
      expect(pastHistory.notes).toMatch(/[ऀ-ॿ]/);
      expect(familyHistory.notes).toMatch(/[ऀ-ॿ]/);
      expect(pastHistory.notes).toContain("note"); // clinician free text is kept verbatim
      expect(pastHistory.notes).toContain("G2P1");
      expect(pastHistory.notes).not.toMatch(/reports\.|patients\.|clinical\./); // no raw keys leaked
    }
  });
});

describe("i18n coverage", () => {
  const usedKeys = new Set<string>();
  for (const q of QUESTIONS) {
    usedKeys.add(q.labelKey);
    usedKeys.add(q.hintKey);
    for (const o of q.options) {
      usedKeys.add(o.labelKey);
      if (o.descKey) usedKeys.add(o.descKey);
    }
  }
  for (const key of Object.values(RISK_FLAG_LABEL_KEYS)) usedKeys.add(key);
  for (const key of [
    "patients.questionnaire.title",
    "patients.questionnaire.badge",
    "patients.questionnaire.subtitle",
    "patients.questionnaire.legend",
    "patients.questionnaire.listAria",
    "patients.questionnaire.countAnnounce",
    "patients.questionnaire.notesLabel",
    "patients.questionnaire.notesPlaceholder",
    "reports.dossier.qnote.primi",
    "reports.dossier.qnote.multi",
    "reports.dossier.qnote.complications",
    "reports.dossier.qnote.chronic",
    "reports.dossier.qnote.clinician",
    "reports.dossier.qnote.familyNone",
    "reports.dossier.qnote.familyRisks",
  ]) {
    usedKeys.add(key);
  }

  it.each(LOCALES)("every question, option, hint, header and note key exists in %s", (locale) => {
    const missing = [...usedKeys].filter((key) => !hasKey(locale, key));
    expect(missing).toEqual([]);
  });

  it("question and option labels are translated, not left in English", () => {
    for (const locale of ["hi", "mr"] as const) {
      const t = makeTranslator(locale);
      for (const q of QUESTIONS) {
        expect(t(q.labelKey), `${locale} ${q.labelKey}`).not.toBe(en(q.labelKey));
        for (const o of q.options) {
          expect(t(o.labelKey), `${locale} ${o.labelKey}`).not.toBe(en(o.labelKey));
        }
      }
    }
  });

  it("does not append Hindi in parentheses to English strings (each locale shows its own language)", () => {
    for (const q of QUESTIONS) {
      for (const key of [q.labelKey, q.hintKey, ...q.options.map((o) => o.labelKey)]) {
        expect(en(key), key).not.toMatch(/[ऀ-ॿ]/);
      }
    }
  });

  it("every risk flag code has a distinct, non-empty label in en, hi and mr", () => {
    for (const locale of LOCALES) {
      const t = makeTranslator(locale);
      const labels = localizeRiskFlags(RISK_FLAG_CODES, t);
      expect(labels).toHaveLength(RISK_FLAG_CODES.length);
      expect(new Set(labels).size, locale).toBe(labels.length);
      for (const [i, label] of labels.entries()) {
        const key = RISK_FLAG_LABEL_KEYS[RISK_FLAG_CODES[i]];
        expect(label.trim(), `${locale} ${key}`).not.toBe("");
        expect(label, `${locale} ${key}`).not.toBe(key);
        if (locale !== "en") expect(label, `${locale} ${key}`).not.toBe(en(key));
      }
    }
  });

  it("the flag label keys cover every flag code exactly", () => {
    expect(Object.keys(RISK_FLAG_LABEL_KEYS).sort()).toEqual([...RISK_FLAG_CODES].sort());
  });

  it("the subtitle and live-region messages are plural-safe", () => {
    for (const locale of LOCALES) {
      const t = makeTranslator(locale);
      for (const key of ["patients.questionnaire.subtitle", "patients.questionnaire.countAnnounce"] as const) {
        for (const count of [1, 4, 7]) {
          const text = t(key, { count });
          expect(text).toContain(String(count));
          expect(text).not.toContain("{count}");
        }
      }
    }
  });
});

/**
 * Past-pregnancy clinical questionnaire (new-patient form -> 1-page report).
 * Standardised for Indian antenatal care (FOGSI / PMSMA protocols).
 *
 * Everything the form, the server action and the report must agree on lives
 * here as plain, pure data and functions (no React, no message catalogue), so
 * it is unit-testable and safe to import from a client component:
 *
 *   - QUESTIONS: the question list (ids, option ids, i18n keys, visibility rule);
 *   - numbering: a question's number is its position in the VISIBLE list
 *     (`getVisibleQuestions`, `questionNumber`), never a hard-coded string;
 *   - normalizeQuestionnaire(): validation/sanitising of untrusted input, which
 *     also resets hidden answers to their defaults;
 *   - questionnaireToObstetricReport(): mapping to the report's history shape,
 *     with risk flags returned as stable codes (localised at display time).
 *
 * Persistence: the questionnaire is stored ONLY by the demo store
 * (lib/demo-data.ts). The real database has no columns for it (no migration
 * was added on purpose), so a real-mode registration validates and then drops it.
 */

import { z } from "zod";
import type { MessageKey } from "@/lib/i18n/messages";
import type { Translator } from "@/lib/i18n/translate-client";
import type { FamilyPregnancyHistory, PastObstetricHistory } from "./obstetricReportData";

// ---------------------------------------------------------------------------
// Answer vocabulary: the single source for the zod schema, the UI and the tests
// ---------------------------------------------------------------------------

/** Multi-select "nothing applies" choice. Exclusive: it never co-exists with another choice. */
export const NONE = "none" as const;
/** Stored when a question is hidden or unanswered ("not applicable"). */
export const NOT_APPLICABLE = "na" as const;

export const DELIVERY_MODES = ["Primi", "NVD", "LSCS", "Instrumental"] as const;
export const PRIOR_COMPLICATIONS = [NONE, "preeclampsia", "gdm", "pph", "preterm"] as const;
export const PREGNANCY_LOSSES = ["0", "1", "2+", "stillbirth"] as const;
const BIRTH_WEIGHT_CHOICES = ["normal", "low", "high"] as const;
export const BIRTH_WEIGHTS = [...BIRTH_WEIGHT_CHOICES, NOT_APPLICABLE] as const;
const INTERVAL_CHOICES = ["<18m", "18m-5y", ">5y"] as const;
export const INTERPREGNANCY_INTERVALS = [...INTERVAL_CHOICES, NOT_APPLICABLE] as const;
export const FAMILY_COMPLICATIONS = [NONE, "preeclampsia", "diabetes", "twins", "anemia"] as const;
export const CHRONIC_CONDITIONS = [NONE, "hypertension", "thyroid", "cardiac", "asthma_epilepsy"] as const;

export type DeliveryMode = (typeof DELIVERY_MODES)[number];
export type PriorComplication = (typeof PRIOR_COMPLICATIONS)[number];
export type PregnancyLoss = (typeof PREGNANCY_LOSSES)[number];
export type BirthWeight = (typeof BIRTH_WEIGHTS)[number];
export type InterpregnancyInterval = (typeof INTERPREGNANCY_INTERVALS)[number];
export type FamilyComplication = (typeof FAMILY_COMPLICATIONS)[number];
export type ChronicCondition = (typeof CHRONIC_CONDITIONS)[number];

export interface ObstetricQuestionnaireData {
  previousDeliveryMode: DeliveryMode;
  priorComplications: readonly PriorComplication[];
  pastPregnancyLoss: PregnancyLoss;
  pastBirthWeight: BirthWeight;
  interpregnancyInterval: InterpregnancyInterval;
  familyComplications: readonly FamilyComplication[];
  chronicConditions: readonly ChronicCondition[];
  doctorNotes?: string;
}

/** What `normalizeQuestionnaire` returns: every field present and valid. */
export type NormalizedObstetricQuestionnaire = ObstetricQuestionnaireData & { doctorNotes: string };

/** A question's id is the name of the answer it collects. */
export type QuestionId = Exclude<keyof ObstetricQuestionnaireData, "doctorNotes">;

export const DOCTOR_NOTES_MAX = 500;

// ---------------------------------------------------------------------------
// The question list
// ---------------------------------------------------------------------------

type Answers = ObstetricQuestionnaireData;
type AnswerValue = string | readonly string[];

export interface OptionDef {
  readonly id: string;
  readonly labelKey: MessageKey;
  /** Secondary line under the label (delivery-mode cards only). */
  readonly descKey?: MessageKey;
  /** Highlight the option as a clinical alert when selected (may depend on other answers). */
  readonly alert?: boolean | ((answers: Answers) => boolean);
}

export interface QuestionDef {
  readonly id: QuestionId;
  readonly kind: "single" | "multi";
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
  /** The choices the form offers, in display order. */
  readonly options: readonly OptionDef[];
  /** Whether the question applies given the answers so far. Hidden questions are neither shown, numbered nor submitted. */
  readonly visible: (answers: Answers) => boolean;
  /** Answer when unanswered, and the value a hidden question is reset to. */
  readonly defaultValue: AnswerValue;
  /** Answer preselected when a hidden question becomes visible again. */
  readonly valueWhenShown?: AnswerValue;
}

type OptionMeta = Omit<OptionDef, "id">;

/** Pairs each id with its metadata; the Record type makes a missing option a compile error. */
function buildOptions<Id extends string>(ids: readonly Id[], meta: Record<Id, OptionMeta>): readonly OptionDef[] {
  return ids.map((id) => ({ id, ...meta[id] }));
}

const always = (): boolean => true;
/** Q2, Q4 and Q5 only make sense after at least one earlier delivery. */
const afterFirstPregnancy = (a: Answers): boolean => a.previousDeliveryMode !== "Primi";

export const QUESTIONS: readonly QuestionDef[] = [
  {
    id: "previousDeliveryMode",
    kind: "single",
    labelKey: "patients.questionnaire.delivery.label",
    hintKey: "patients.questionnaire.delivery.hint",
    options: buildOptions(DELIVERY_MODES, {
      Primi: { labelKey: "patients.questionnaire.delivery.primi", descKey: "patients.questionnaire.delivery.primiDesc" },
      NVD: { labelKey: "patients.questionnaire.delivery.nvd", descKey: "patients.questionnaire.delivery.nvdDesc" },
      LSCS: { labelKey: "patients.questionnaire.delivery.lscs", descKey: "patients.questionnaire.delivery.lscsDesc", alert: true },
      Instrumental: { labelKey: "patients.questionnaire.delivery.instrumental", descKey: "patients.questionnaire.delivery.instrumentalDesc" },
    }),
    visible: always,
    defaultValue: "Primi",
  },
  {
    id: "priorComplications",
    kind: "multi",
    labelKey: "patients.questionnaire.complications.label",
    hintKey: "patients.questionnaire.complications.hint",
    options: buildOptions(PRIOR_COMPLICATIONS, {
      none: { labelKey: "patients.questionnaire.complications.none" },
      preeclampsia: { labelKey: "patients.questionnaire.complications.preeclampsia", alert: true },
      gdm: { labelKey: "patients.questionnaire.complications.gdm", alert: true },
      pph: { labelKey: "patients.questionnaire.complications.pph", alert: true },
      preterm: { labelKey: "patients.questionnaire.complications.preterm", alert: true },
    }),
    visible: afterFirstPregnancy,
    defaultValue: [NONE],
    valueWhenShown: [NONE],
  },
  {
    id: "pastPregnancyLoss",
    kind: "single",
    labelKey: "patients.questionnaire.loss.label",
    hintKey: "patients.questionnaire.loss.hint",
    options: buildOptions(PREGNANCY_LOSSES, {
      "0": { labelKey: "patients.questionnaire.loss.none" },
      "1": { labelKey: "patients.questionnaire.loss.one" },
      "2+": { labelKey: "patients.questionnaire.loss.twoPlus", alert: true },
      stillbirth: { labelKey: "patients.questionnaire.loss.stillbirth", alert: true },
    }),
    visible: always,
    defaultValue: "0",
  },
  {
    id: "pastBirthWeight",
    kind: "single",
    labelKey: "patients.questionnaire.birthWeight.label",
    hintKey: "patients.questionnaire.birthWeight.hint",
    options: buildOptions(BIRTH_WEIGHT_CHOICES, {
      normal: { labelKey: "patients.questionnaire.birthWeight.normal" },
      low: { labelKey: "patients.questionnaire.birthWeight.low", alert: true },
      high: { labelKey: "patients.questionnaire.birthWeight.high", alert: true },
    }),
    visible: afterFirstPregnancy,
    defaultValue: NOT_APPLICABLE,
    valueWhenShown: "normal",
  },
  {
    id: "interpregnancyInterval",
    kind: "single",
    labelKey: "patients.questionnaire.interval.label",
    hintKey: "patients.questionnaire.interval.hint",
    options: buildOptions(INTERVAL_CHOICES, {
      "<18m": { labelKey: "patients.questionnaire.interval.short", alert: (a) => a.previousDeliveryMode === "LSCS" },
      "18m-5y": { labelKey: "patients.questionnaire.interval.optimal" },
      ">5y": { labelKey: "patients.questionnaire.interval.long" },
    }),
    visible: afterFirstPregnancy,
    defaultValue: NOT_APPLICABLE,
    valueWhenShown: "18m-5y",
  },
  {
    id: "familyComplications",
    kind: "multi",
    labelKey: "patients.questionnaire.family.label",
    hintKey: "patients.questionnaire.family.hint",
    options: buildOptions(FAMILY_COMPLICATIONS, {
      none: { labelKey: "patients.questionnaire.family.none" },
      preeclampsia: { labelKey: "patients.questionnaire.family.preeclampsia" },
      diabetes: { labelKey: "patients.questionnaire.family.diabetes" },
      twins: { labelKey: "patients.questionnaire.family.twins" },
      anemia: { labelKey: "patients.questionnaire.family.anaemia" },
    }),
    visible: always,
    defaultValue: [NONE],
  },
  {
    id: "chronicConditions",
    kind: "multi",
    labelKey: "patients.questionnaire.chronic.label",
    hintKey: "patients.questionnaire.chronic.hint",
    options: buildOptions(CHRONIC_CONDITIONS, {
      none: { labelKey: "patients.questionnaire.chronic.none" },
      hypertension: { labelKey: "patients.questionnaire.chronic.hypertension", alert: true },
      thyroid: { labelKey: "patients.questionnaire.chronic.thyroid" },
      cardiac: { labelKey: "patients.questionnaire.chronic.cardiac", alert: true },
      asthma_epilepsy: { labelKey: "patients.questionnaire.chronic.asthmaEpilepsy" },
    }),
    visible: always,
    defaultValue: [NONE],
  },
];

const QUESTION_BY_ID = new Map<QuestionId, QuestionDef>(QUESTIONS.map((q) => [q.id, q]));

export function getQuestion(id: QuestionId): QuestionDef {
  const q = QUESTION_BY_ID.get(id);
  if (!q) throw new Error(`Unknown questionnaire question: ${id}`);
  return q;
}

/** The questions that apply to these answers, in display order. */
export function getVisibleQuestions(answers: Answers): readonly QuestionDef[] {
  return QUESTIONS.filter((q) => q.visible(answers));
}

/**
 * 1-based number of a question as the clinician sees it: its position in the
 * VISIBLE list (so a primigravida sees 1, 2, 3, 4). `null` when the question is hidden.
 */
export function questionNumber(answers: Answers, id: QuestionId): number | null {
  const index = getVisibleQuestions(answers).findIndex((q) => q.id === id);
  return index === -1 ? null : index + 1;
}

/** Whether a selected option should be highlighted as a clinical alert. */
export function isAlertOption(option: OptionDef, answers: Answers): boolean {
  return typeof option.alert === "function" ? option.alert(answers) : option.alert === true;
}

// ---------------------------------------------------------------------------
// Defaults and answer updates (pure; used by the form's state)
// ---------------------------------------------------------------------------

function cloneValue(value: AnswerValue): AnswerValue {
  return typeof value === "string" ? value : [...value];
}

/** Returns a copy of `answers` with one answer replaced. The cast is covered by the tests. */
function withAnswer<T extends Answers>(answers: T, id: QuestionId, value: AnswerValue): T {
  return { ...answers, [id]: cloneValue(value) } as T;
}

/** A fresh default questionnaire (a primigravida with nothing to report). */
export function createDefaultQuestionnaire(): NormalizedObstetricQuestionnaire {
  let answers = { doctorNotes: "" } as NormalizedObstetricQuestionnaire;
  for (const q of QUESTIONS) answers = withAnswer(answers, q.id, q.defaultValue);
  return answers;
}

export const DEFAULT_OBSTETRIC_QUESTIONNAIRE: NormalizedObstetricQuestionnaire = (() => {
  const d = createDefaultQuestionnaire();
  Object.values(d).forEach((v) => Array.isArray(v) && Object.freeze(v));
  return Object.freeze(d);
})();

/**
 * Resets every hidden question to its default. Repeats until stable because a
 * reset answer could in principle change another question's visibility.
 */
export function resetHiddenAnswers<T extends Answers>(answers: T): T {
  let current = answers;
  for (let pass = 0; pass < QUESTIONS.length; pass++) {
    let changed = false;
    for (const q of QUESTIONS) {
      if (q.visible(current)) continue;
      const next = withAnswer(current, q.id, q.defaultValue);
      if (JSON.stringify(next[q.id]) !== JSON.stringify(current[q.id])) {
        current = next;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return current;
}

/**
 * Applies a change that may flip question visibility: questions that just
 * disappeared are reset to their default, questions that just appeared get
 * their sensible preselection (e.g. "normal" birth weight after switching away
 * from Primi).
 */
function applyChange<T extends Answers>(previous: T, changed: T): T {
  let next = resetHiddenAnswers(changed);
  for (const q of QUESTIONS) {
    if (q.valueWhenShown === undefined) continue;
    if (!q.visible(previous) && q.visible(next)) next = withAnswer(next, q.id, q.valueWhenShown);
  }
  return next;
}

/** Selects one option of a single-choice question. Unknown ids and non-single questions are ignored. */
export function setAnswer<T extends Answers>(answers: T, id: QuestionId, value: string): T {
  const q = getQuestion(id);
  if (q.kind !== "single" || !q.options.some((o) => o.id === value)) return answers;
  return applyChange(answers, withAnswer(answers, id, value));
}

/**
 * Toggles one option of a multi-choice question. "None" is exclusive: choosing
 * it clears everything else, choosing anything else clears it, and clearing the
 * last choice falls back to "None".
 */
export function toggleAnswer<T extends Answers>(answers: T, id: QuestionId, item: string): T {
  const q = getQuestion(id);
  if (q.kind !== "multi" || !q.options.some((o) => o.id === item)) return answers;
  const current = answers[id] as readonly string[];
  let next: string[];
  if (item === NONE) {
    next = [NONE];
  } else {
    const withoutNone = current.filter((x) => x !== NONE);
    next = withoutNone.includes(item) ? withoutNone.filter((x) => x !== item) : [...withoutNone, item];
    if (next.length === 0) next = [NONE];
  }
  return applyChange(answers, withAnswer(answers, id, next));
}

// ---------------------------------------------------------------------------
// Normalisation of untrusted input
// ---------------------------------------------------------------------------

// C0/C1 control characters plus bidirectional overrides/isolates (which can
// visually reorder text on the printed report). Zero-width joiners are kept:
// Devanagari conjuncts need them.
const CONTROL_CHARS = /[\p{Cc}‪-‮⁦-⁩]/gu;

/** Strips control characters, collapses whitespace and caps the length. */
export function sanitizeDoctorNotes(value: string): string {
  const cleaned = value.normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(cleaned);
  return chars.length > DOCTOR_NOTES_MAX ? chars.slice(0, DOCTOR_NOTES_MAX).join("").trimEnd() : cleaned;
}

/**
 * Keeps only whitelisted ids, de-duplicated and in canonical order. "None" is
 * exclusive: if any real choice is present it wins (a risk is never hidden by a
 * stray "none"); an empty result becomes ["none"].
 */
function cleanMultiSelect<T extends string>(values: readonly unknown[], allowed: readonly T[]): T[] {
  const picked = allowed.filter((id) => id !== NONE && values.includes(id));
  return picked.length > 0 ? picked : ([NONE] as unknown as T[]);
}

const multiSelect = <T extends string>(allowed: readonly T[]) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((values) => cleanMultiSelect(values, allowed));

// Every field falls back to its default instead of failing the whole object, so
// one bad value never discards the rest and safeParse can only fail for a
// non-object input.
const questionnaireSchema = z.object({
  previousDeliveryMode: z.enum(DELIVERY_MODES).catch("Primi"),
  priorComplications: multiSelect(PRIOR_COMPLICATIONS),
  pastPregnancyLoss: z.enum(PREGNANCY_LOSSES).catch("0"),
  pastBirthWeight: z.enum(BIRTH_WEIGHTS).catch(NOT_APPLICABLE),
  interpregnancyInterval: z.enum(INTERPREGNANCY_INTERVALS).catch(NOT_APPLICABLE),
  familyComplications: multiSelect(FAMILY_COMPLICATIONS),
  chronicConditions: multiSelect(CHRONIC_CONDITIONS),
  doctorNotes: z.string().catch("").transform(sanitizeDoctorNotes),
});

/**
 * Validates untrusted questionnaire input (form fields, the demo store, a
 * caller's object): unknown ids are dropped, "none" is exclusive, notes are
 * sanitised and capped, and the answers to hidden questions are reset to their
 * defaults, so a primigravida never carries prior-delivery answers. Never
 * throws; idempotent.
 */
export function normalizeQuestionnaire(raw: unknown): NormalizedObstetricQuestionnaire {
  const parsed = questionnaireSchema.safeParse(raw);
  return resetHiddenAnswers(parsed.success ? parsed.data : createDefaultQuestionnaire());
}

// ---------------------------------------------------------------------------
// Form transport (client -> server action)
// ---------------------------------------------------------------------------

export function questionnaireFieldName(key: keyof ObstetricQuestionnaireData): string {
  return `q_${key}`;
}

export interface QuestionnaireFormField {
  name: string;
  value: string;
}

/**
 * The hidden fields the form submits: one per VISIBLE question (multi-select
 * answers as JSON arrays) plus the notes, all taken from the normalised answers.
 * Hidden questions are not submitted at all.
 */
export function questionnaireFormFields(answers: unknown): QuestionnaireFormField[] {
  const normalized = normalizeQuestionnaire(answers);
  const fields = getVisibleQuestions(normalized).map((q) => {
    const value = normalized[q.id];
    return { name: questionnaireFieldName(q.id), value: q.kind === "multi" ? JSON.stringify(value) : String(value) };
  });
  fields.push({ name: questionnaireFieldName("doctorNotes"), value: normalized.doctorNotes });
  return fields;
}

const MAX_JSON_FIELD_LENGTH = 2_000;

/** Parses a JSON-array form field. Malformed, oversized or non-array input yields []; never throws. */
export function parseJsonArrayField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || value.length > MAX_JSON_FIELD_LENGTH) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Reads the questionnaire out of raw form fields (`Object.fromEntries(formData)`).
 * Returns `undefined` when the form did not include the questionnaire at all,
 * otherwise the normalised answers. Never throws.
 */
export function questionnaireFromFormFields(fields: Record<string, unknown>): NormalizedObstetricQuestionnaire | undefined {
  const mode = fields[questionnaireFieldName("previousDeliveryMode")];
  if (typeof mode !== "string" || mode.trim() === "") return undefined;
  const field = (key: keyof ObstetricQuestionnaireData) => fields[questionnaireFieldName(key)];
  return normalizeQuestionnaire({
    previousDeliveryMode: mode,
    priorComplications: parseJsonArrayField(field("priorComplications")),
    pastPregnancyLoss: field("pastPregnancyLoss"),
    pastBirthWeight: field("pastBirthWeight"),
    interpregnancyInterval: field("interpregnancyInterval"),
    familyComplications: parseJsonArrayField(field("familyComplications")),
    chronicConditions: parseJsonArrayField(field("chronicConditions")),
    doctorNotes: field("doctorNotes"),
  });
}

// ---------------------------------------------------------------------------
// Risk flags (stable codes; the UI localises them)
// ---------------------------------------------------------------------------

export const RISK_FLAG_CODES = [
  "prev_lscs",
  "prior_preeclampsia",
  "prior_gdm",
  "prior_pph",
  "prior_preterm",
  "recurrent_pregnancy_loss",
  "prior_stillbirth",
  "prior_low_birth_weight",
  "short_interval_post_lscs",
  "chronic_hypertension",
  "thyroid_disorder",
  "cardiac_disease",
] as const;

export type RiskFlagCode = (typeof RISK_FLAG_CODES)[number];

/** Catalogue key of each flag's label (lib/i18n/messages/reports.ts). */
export const RISK_FLAG_LABEL_KEYS = {
  prev_lscs: "reports.dossier.flag.prevLscs",
  prior_preeclampsia: "reports.dossier.flag.priorPreeclampsia",
  prior_gdm: "reports.dossier.flag.priorGdm",
  prior_pph: "reports.dossier.flag.priorPph",
  prior_preterm: "reports.dossier.flag.priorPreterm",
  recurrent_pregnancy_loss: "reports.dossier.flag.recurrentLoss",
  prior_stillbirth: "reports.dossier.flag.priorStillbirth",
  prior_low_birth_weight: "reports.dossier.flag.priorLowBirthWeight",
  short_interval_post_lscs: "reports.dossier.flag.shortIntervalPostLscs",
  chronic_hypertension: "reports.dossier.flag.chronicHypertension",
  thyroid_disorder: "reports.dossier.flag.thyroidDisorder",
  cardiac_disease: "reports.dossier.flag.cardiacDisease",
} as const satisfies Record<RiskFlagCode, MessageKey>;

/** Localised label of each flag code, in the order given. */
export function localizeRiskFlags(codes: readonly RiskFlagCode[], t: Translator): string[] {
  return codes.map((code) => t(RISK_FLAG_LABEL_KEYS[code]));
}

/**
 * Risk flags implied by the answers. Input is normalised first, so an answer to
 * a hidden question (e.g. complications left over from before switching to
 * Primi) can never produce a flag.
 */
export function deriveRiskFlags(raw: unknown): RiskFlagCode[] {
  const a = normalizeQuestionnaire(raw);
  const flags: RiskFlagCode[] = [];
  if (a.previousDeliveryMode === "LSCS") flags.push("prev_lscs");
  if (a.priorComplications.includes("preeclampsia")) flags.push("prior_preeclampsia");
  if (a.priorComplications.includes("gdm")) flags.push("prior_gdm");
  if (a.priorComplications.includes("pph")) flags.push("prior_pph");
  if (a.priorComplications.includes("preterm")) flags.push("prior_preterm");
  if (a.pastPregnancyLoss === "2+") flags.push("recurrent_pregnancy_loss");
  if (a.pastPregnancyLoss === "stillbirth") flags.push("prior_stillbirth");
  if (a.pastBirthWeight === "low") flags.push("prior_low_birth_weight");
  if (a.interpregnancyInterval === "<18m" && a.previousDeliveryMode === "LSCS") flags.push("short_interval_post_lscs");
  if (a.chronicConditions.includes("hypertension")) flags.push("chronic_hypertension");
  if (a.chronicConditions.includes("thyroid")) flags.push("thyroid_disorder");
  if (a.chronicConditions.includes("cardiac")) flags.push("cardiac_disease");
  return flags;
}

// ---------------------------------------------------------------------------
// Mapping to the 1-page report
// ---------------------------------------------------------------------------

const DELIVERY_MODE_REPORT: Record<DeliveryMode, PastObstetricHistory["previousDeliveryMode"]> = {
  Primi: "None (Primi)",
  NVD: "NVD",
  LSCS: "LSCS",
  Instrumental: "Assisted (Forceps/Vacuum)",
};

const DELIVERY_MODE_NOTE_KEYS: Record<Exclude<DeliveryMode, "Primi">, MessageKey> = {
  NVD: "clinical.delivery.NVD",
  LSCS: "clinical.delivery.LSCS",
  Instrumental: "reports.dossier.assisted",
};

/**
 * Representative months for each interval band (the report shows a single
 * number). Not applicable (first pregnancy / unanswered) is null so the
 * report prints "first pregnancy" instead of an invented figure.
 */
const INTERVAL_MONTHS: Record<InterpregnancyInterval, number | null> = {
  "<18m": 12,
  "18m-5y": 36,
  ">5y": 60,
  na: null,
};

/** Localised, comma-separated labels of the selected options of a multi-select question (without "none"). */
function selectedLabels(id: QuestionId, selected: readonly string[], t: Translator): string {
  return getQuestion(id)
    .options.filter((o) => o.id !== NONE && selected.includes(o.id))
    .map((o) => t(o.labelKey))
    .join(", ");
}

export interface QuestionnaireReport {
  pastHistory: PastObstetricHistory;
  familyHistory: FamilyPregnancyHistory;
  /** Stable flag codes; show them with `localizeRiskFlags`. */
  derivedRiskFlags: RiskFlagCode[];
}

/**
 * Converts questionnaire answers into the structured history of the 1-page
 * obstetric dossier. The input is normalised first, so hidden answers can never
 * reach the report. The narrative notes are composed with `t` in the viewer's
 * language; the structured fields and flag codes are language-neutral.
 */
export function questionnaireToObstetricReport(raw: unknown, gravida: number, para: number, t: Translator): QuestionnaireReport {
  const q = normalizeQuestionnaire(raw);

  const miscarriages = q.pastPregnancyLoss === "1" ? 1 : q.pastPregnancyLoss === "2+" ? 2 : 0;
  const stillbirths = q.pastPregnancyLoss === "stillbirth" ? 1 : 0;

  const pastNotes: string[] = [
    q.previousDeliveryMode === "Primi"
      ? t("reports.dossier.qnote.primi")
      : t("reports.dossier.qnote.multi", { gravida, para, mode: t(DELIVERY_MODE_NOTE_KEYS[q.previousDeliveryMode]) }),
  ];
  const complications = selectedLabels("priorComplications", q.priorComplications, t);
  if (complications) pastNotes.push(t("reports.dossier.qnote.complications", { list: complications }));
  const chronic = selectedLabels("chronicConditions", q.chronicConditions, t);
  if (chronic) pastNotes.push(t("reports.dossier.qnote.chronic", { list: chronic }));
  if (q.doctorNotes) pastNotes.push(t("reports.dossier.qnote.clinician", { note: q.doctorNotes }));

  const pastHistory: PastObstetricHistory = {
    previousDeliveryMode: DELIVERY_MODE_REPORT[q.previousDeliveryMode],
    pastPreEclampsia: q.priorComplications.includes("preeclampsia"),
    pastGDM: q.priorComplications.includes("gdm"),
    pastPPH: q.priorComplications.includes("pph"),
    pastMiscarriages: miscarriages,
    pastStillbirths: stillbirths,
    pastLowBirthWeight: q.pastBirthWeight === "low",
    lastChildBirthYear: null,
    interPregnancyMonths: INTERVAL_MONTHS[q.interpregnancyInterval],
    notes: pastNotes.join(" "),
  };

  const familyRisks = selectedLabels("familyComplications", q.familyComplications, t);
  const familyHistory: FamilyPregnancyHistory = {
    familyPreEclampsia: q.familyComplications.includes("preeclampsia"),
    familyDiabetes: q.familyComplications.includes("diabetes"),
    familyTwins: q.familyComplications.includes("twins"),
    familyGeneticAnomalies: q.familyComplications.includes("anemia"),
    familyHypertension: q.familyComplications.includes("preeclampsia"),
    notes: familyRisks ? t("reports.dossier.qnote.familyRisks", { list: familyRisks }) : t("reports.dossier.qnote.familyNone"),
  };

  return { pastHistory, familyHistory, derivedRiskFlags: deriveRiskFlags(q) };
}

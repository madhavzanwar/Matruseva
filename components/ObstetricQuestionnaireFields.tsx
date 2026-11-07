"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { CaretDown, CaretUp, Check, ClipboardText } from "@phosphor-icons/react";
import { card } from "@/components/ui";
import { useT } from "@/lib/i18n/provider";
import type { Translator } from "@/lib/i18n/translate-client";
import {
  DOCTOR_NOTES_MAX,
  getVisibleQuestions,
  isAlertOption,
  normalizeQuestionnaire,
  questionnaireFormFields,
  setAnswer,
  toggleAnswer,
  type ObstetricQuestionnaireData,
  type OptionDef,
  type QuestionDef,
  type QuestionId,
} from "@/lib/obstetricQuestionnaire";

export interface ObstetricQuestionnaireFieldsProps {
  /** Pre-filled answers (e.g. when editing); validated before use. */
  defaultValues?: Partial<ObstetricQuestionnaireData>;
}

/** Grid layout per question (the look of the original form). */
const GRID_CLASS: Record<QuestionId, string> = {
  previousDeliveryMode: "grid grid-cols-2 gap-2 sm:grid-cols-4",
  priorComplications: "grid grid-cols-2 gap-2 sm:grid-cols-3",
  pastPregnancyLoss: "grid grid-cols-2 gap-2 sm:grid-cols-4",
  pastBirthWeight: "grid grid-cols-2 gap-2 sm:grid-cols-3",
  interpregnancyInterval: "grid grid-cols-2 gap-2 sm:grid-cols-3",
  familyComplications: "grid grid-cols-2 gap-2 sm:grid-cols-3",
  chronicConditions: "grid grid-cols-2 gap-2 sm:grid-cols-3",
};

/** Alerts are red, except prior complications which are amber. */
const AMBER_QUESTIONS: ReadonlySet<QuestionId> = new Set<QuestionId>(["priorComplications"]);

function optionClass(selected: boolean, alert: boolean, amber: boolean, roomy: boolean): string {
  const base = `${roomy ? "p-2.5" : "p-2"} cursor-pointer rounded-xl border text-left text-xs transition`;
  if (!selected) {
    return `${base} border-[var(--color-border)] bg-[var(--color-surface-1)] text-[var(--color-charcoal)] hover:bg-[var(--color-surface-2)]`;
  }
  if (alert) {
    return amber
      ? `${base} border-amber-400 bg-amber-50/90 font-semibold text-amber-950 ring-1 ring-amber-400`
      : `${base} border-red-400 bg-red-50 font-semibold text-red-950 ring-1 ring-red-400`;
  }
  return `${base} border-[var(--color-primary)] bg-[var(--color-primary-surface)] font-semibold text-[var(--color-foreground)] ring-1 ring-[var(--color-primary)]`;
}

/** Arrow keys move the selection inside a radio group (WAI-ARIA radio group pattern). */
function onRadioKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
  const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (delta === 0) return;
  const group = e.currentTarget.parentElement;
  if (!group) return;
  e.preventDefault();
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const next = radios[(radios.indexOf(e.currentTarget) + delta + radios.length) % radios.length];
  next.focus();
  next.click();
}

interface QuestionItemProps {
  question: QuestionDef;
  /** Position in the visible list, computed by the parent (never hard-coded). */
  number: number;
  answers: ObstetricQuestionnaireData;
  idPrefix: string;
  t: Translator;
  onSelect: (id: QuestionId, value: string) => void;
  onToggle: (id: QuestionId, value: string) => void;
}

function QuestionItem({ question: q, number, answers, idPrefix, t, onSelect, onToggle }: QuestionItemProps) {
  const labelId = `${idPrefix}-${q.id}-label`;
  const hintId = `${idPrefix}-${q.id}-hint`;
  const isSingle = q.kind === "single";
  const current = answers[q.id];
  const roomy = q.options.some((o) => o.descKey);
  const amber = AMBER_QUESTIONS.has(q.id);
  const anySelected = q.options.some((o) => (isSingle ? current === o.id : (current as readonly string[]).includes(o.id)));

  const renderOption = (o: OptionDef, index: number) => {
    const selected = isSingle ? current === o.id : (current as readonly string[]).includes(o.id);
    const className = optionClass(selected, isAlertOption(o, answers), amber, roomy);
    if (isSingle) {
      return (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={selected}
          // Roving tabindex: one tab stop per group, arrow keys move within it.
          tabIndex={selected || (!anySelected && index === 0) ? 0 : -1}
          onClick={() => onSelect(q.id, o.id)}
          onKeyDown={onRadioKeyDown}
          className={className}
        >
          <span className="block">{t(o.labelKey)}</span>
          {o.descKey && <span className="mt-0.5 block text-[10px] opacity-75">{t(o.descKey)}</span>}
        </button>
      );
    }
    return (
      <button key={o.id} type="button" role="checkbox" aria-checked={selected} onClick={() => onToggle(q.id, o.id)} className={className}>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border ${
              selected
                ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                : "border-[var(--color-border-strong)] bg-[var(--color-background)]"
            }`}
          >
            {selected && <Check size={10} weight="bold" />}
          </span>
          <span>{t(o.labelKey)}</span>
        </span>
      </button>
    );
  };

  return (
    <li>
      <div role={isSingle ? "radiogroup" : "group"} aria-labelledby={labelId} aria-describedby={hintId} className="space-y-2">
        <div>
          <p id={labelId} className="flex gap-1.5 text-[13px] font-bold text-[var(--color-foreground)]">
            {/* The list semantics already announce the position; the number is for sighted users. */}
            <span aria-hidden="true" className="num shrink-0">
              {number}.
            </span>
            <span>{t(q.labelKey)}</span>
          </p>
          <p id={hintId} className="mt-0.5 text-[12px] text-[var(--color-charcoal)]">
            {t(q.hintKey)}
          </p>
        </div>
        <div className={GRID_CLASS[q.id]}>{q.options.map(renderOption)}</div>
      </div>
    </li>
  );
}

export function ObstetricQuestionnaireFields({ defaultValues }: ObstetricQuestionnaireFieldsProps) {
  const t = useT();
  const idPrefix = useId();
  const panelId = `${idPrefix}-panel`;
  const titleId = `${idPrefix}-title`;
  const badgeId = `${idPrefix}-badge`;
  const subtitleId = `${idPrefix}-subtitle`;
  const notesId = `${idPrefix}-notes`;

  const [isOpen, setIsOpen] = useState(true);
  const [answers, setAnswers] = useState<ObstetricQuestionnaireData>(() => normalizeQuestionnaire(defaultValues ?? {}));

  // The visible list drives everything: which questions render, their numbers and
  // which fields are submitted. A primigravida sees four questions numbered 1-4.
  const visibleQuestions = getVisibleQuestions(answers);
  const count = visibleQuestions.length;

  // What is submitted is the normalised copy of the visible answers only, so a
  // stale answer to a hidden question can never reach the server.
  const submittedFields = useMemo(() => questionnaireFormFields(answers), [answers]);

  const onSelect = (id: QuestionId, value: string) => setAnswers((prev) => setAnswer(prev, id, value));
  const onToggle = (id: QuestionId, value: string) => setAnswers((prev) => toggleAnswer(prev, id, value));

  return (
    <fieldset className={`${card} min-w-0 overflow-hidden border-indigo-200/60 transition-all`}>
      <legend className="sr-only">{t("patients.questionnaire.legend")}</legend>

      {/* Polite announcement when answering the first question adds or removes questions. */}
      <p aria-live="polite" className="sr-only">
        {t("patients.questionnaire.countAnnounce", { count })}
      </p>

      {submittedFields.map((f) => (
        <input key={f.name} type="hidden" name={f.name} value={f.value} />
      ))}

      <div className="bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-pc-lilac)_80%,transparent)_0%,transparent_100%)]">
        <h2>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={panelId}
            aria-labelledby={`${titleId} ${badgeId}`}
            aria-describedby={subtitleId}
            onClick={() => setIsOpen((open) => !open)}
            className="flex w-full cursor-pointer select-none items-center justify-between gap-3 p-4 text-left sm:p-5"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] text-white shadow-xs"
              >
                <ClipboardText size={18} weight="bold" />
              </span>
              <span className="block min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-[var(--color-foreground)]">
                  <span id={titleId}>{t("patients.questionnaire.title")}</span>
                  <span
                    id={badgeId}
                    className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800"
                  >
                    {t("patients.questionnaire.badge")}
                  </span>
                </span>
                <span id={subtitleId} className="block text-[12px] font-normal text-[var(--color-charcoal)]">
                  {t("patients.questionnaire.subtitle", { count })}
                </span>
              </span>
            </span>
            <span aria-hidden="true" className="shrink-0 rounded-md p-1 text-[var(--color-charcoal)]">
              {isOpen ? <CaretUp size={18} /> : <CaretDown size={18} />}
            </span>
          </button>
        </h2>
      </div>

      {/* Kept mounted (just hidden) so aria-controls always points at a real element. */}
      <div id={panelId} hidden={!isOpen} className="border-t border-[var(--color-border)] bg-[var(--color-background)] p-5">
        <ol role="list" aria-label={t("patients.questionnaire.listAria")} className="m-0 list-none space-y-5 p-0">
          {visibleQuestions.map((q, i) => (
            <QuestionItem
              key={q.id}
              question={q}
              number={i + 1}
              answers={answers}
              idPrefix={idPrefix}
              t={t}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ol>

        <div className="mt-5 space-y-1">
          <label htmlFor={notesId} className="block text-[12px] font-medium text-[var(--color-charcoal)]">
            {t("patients.questionnaire.notesLabel")}
          </label>
          {/* No name on purpose: the (normalised, length-capped) text is submitted through the hidden q_doctorNotes field above. */}
          <input
            id={notesId}
            type="text"
            autoComplete="off"
            maxLength={DOCTOR_NOTES_MAX}
            placeholder={t("patients.questionnaire.notesPlaceholder")}
            value={answers.doctorNotes ?? ""}
            onChange={(e) => {
              const doctorNotes = e.target.value;
              setAnswers((prev) => ({ ...prev, doctorNotes }));
            }}
            className="min-h-9 w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 text-xs focus:border-[var(--color-primary)] focus:outline-none"
          />
        </div>
      </div>
    </fieldset>
  );
}

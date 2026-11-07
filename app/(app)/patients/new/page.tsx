"use client";

import { useActionState, useMemo, useState } from "react";
import { createPatient, type ActionResult } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import { ObstetricQuestionnaireFields } from "@/components/ObstetricQuestionnaireFields";
import { PageHeader, card, pageBody } from "@/components/ui";
import { eddFromLmp, formatGALocalized, gestationalAge, trimester } from "@/lib/pregnancy";
import { useLocale, useT } from "@/lib/i18n/provider";
import { intlLocale } from "@/lib/i18n/intl";

const initialState: ActionResult = { error: null };

const inputClass =
  "min-h-11 w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 text-[15px]";
const labelClass = "mb-1.5 block text-[13px] font-medium text-[var(--color-charcoal)]";

function parseLocalDate(isoDate: string): Date | null {
  if (!isoDate) return null;
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function Field({ id, label, className = "", children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className={card}>
      <legend className="sr-only">{title}</legend>
      <p className="px-5 pt-5 text-[16px] font-semibold text-[var(--color-foreground)]">{title}</p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-5 sm:grid-cols-6">{children}</div>
    </fieldset>
  );
}

export default function NewPatientPage() {
  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState(createPatient, initialState);
  const [lmp, setLmp] = useState("");

  const preview = useMemo(() => {
    const lmpDate = parseLocalDate(lmp);
    if (!lmpDate) return null;
    const ga = gestationalAge(lmpDate, new Date());
    if (ga.weeks > 44) return { error: t("patients.new.lmpTooOld") };
    return {
      edd: eddFromLmp(lmpDate).toLocaleDateString(intlLocale(locale), { day: "2-digit", month: "short", year: "numeric" }),
      ga: formatGALocalized(ga, t),
      trimester: trimester(ga),
    };
  }, [lmp, t, locale]);

  return (
    <>
      <PageHeader title={t("patients.new.title")} meta={t("patients.new.meta")} />
      <div className={pageBody}>
      <form action={formAction} className="max-w-3xl space-y-5" noValidate>
        <Section title={t("patients.new.sectionIdentity")}>
          <Field id="name" label={t("patients.new.fullName")} className="col-span-2 sm:col-span-4">
            <input id="name" name="name" type="text" required autoFocus className={inputClass} />
          </Field>
          <Field id="clinicPatientNo" label={t("patients.new.cardNo")} className="col-span-2">
            <input id="clinicPatientNo" name="clinicPatientNo" type="text" className={`${inputClass} num`} />
          </Field>
          <Field id="phone" label={t("patients.new.mobile")} className="col-span-1 sm:col-span-3">
            <input id="phone" name="phone" type="tel" inputMode="numeric" placeholder={t("patients.new.mobilePlaceholder")} className={`${inputClass} num`} />
          </Field>
          <Field id="altPhone" label={t("patients.new.altMobile")} className="col-span-1 sm:col-span-3">
            <input id="altPhone" name="altPhone" type="tel" inputMode="numeric" className={`${inputClass} num`} />
          </Field>
          <Field id="address" label={t("patients.new.address")} className="col-span-2 sm:col-span-6">
            <input id="address" name="address" type="text" className={inputClass} />
          </Field>
        </Section>

        <Section title={t("patients.new.sectionObstetric")}>
          <Field id="age" label={t("patients.new.age")} className="sm:col-span-1">
            <input id="age" name="age" type="number" min={10} max={70} className={`${inputClass} num`} />
          </Field>
          <Field id="gravida" label={t("patients.new.gravida")} className="sm:col-span-1">
            <input id="gravida" name="gravida" type="number" min={0} max={20} className={`${inputClass} num`} />
          </Field>
          <Field id="para" label={t("patients.new.para")} className="sm:col-span-1">
            <input id="para" name="para" type="number" min={0} max={20} className={`${inputClass} num`} />
          </Field>
          <Field id="bloodGroup" label={t("patients.new.bloodGroup")} className="sm:col-span-1">
            <select id="bloodGroup" name="bloodGroup" className={inputClass} defaultValue="">
              <option value="">{t("patients.new.unknown")}</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bg) => (
                <option key={bg} value={bg}>
                  {bg}
                </option>
              ))}
            </select>
          </Field>
          <label className="rounded-xl col-span-2 flex min-h-11 items-center gap-2 self-end border border-[var(--color-border)] bg-[var(--color-surface-1)] px-3 text-[14px]">
            <input type="checkbox" name="rhNegative" className="h-4 w-4 accent-[var(--color-primary)]" />
            {t("patients.new.rhNegative")}
          </label>
        </Section>

        {/* Past pregnancy history & clinical questionnaire: feeds the 1-page report */}
        <ObstetricQuestionnaireFields />

        <Section title={t("patients.new.sectionDating")}>
          <Field id="lmp" label={t("patients.new.lmp")} className="col-span-2 sm:col-span-2">
            <input
              id="lmp"
              name="lmp"
              type="date"
              required
              className={`${inputClass} num`}
              value={lmp}
              onChange={(e) => setLmp(e.target.value)}
            />
          </Field>
          <div className="col-span-2 grid grid-cols-3 self-end rounded-xl bg-[var(--color-primary-surface)]/60 sm:col-span-4">
            {preview && "error" in preview ? (
              <p className="col-span-3 px-3 py-2 text-[13px] text-[var(--color-overdue)]">{preview.error}</p>
            ) : (
              [
                [t("patients.new.previewEdd"), preview?.edd],
                [t("patients.new.previewGa"), preview?.ga],
                [t("patients.new.previewTrimester"), preview ? t("patients.trimesterShort", { trimester: preview.trimester }) : undefined],
              ].map(([label, value]) => (
                <div key={label} className="px-3 py-2">
                  <p className="text-[12px] font-medium text-[var(--color-charcoal)]">{label}</p>
                  <p className="num text-[14px] font-medium">{value ?? "—"}</p>
                </div>
              ))
            )}
          </div>
        </Section>

        {state.error && (
          <p role="alert" className="rounded-xl bg-[var(--color-overdue-surface)] px-4 py-3 text-[13px] text-[var(--color-overdue)]">
            {state.error}
          </p>
        )}

        <div className="max-w-xs">
          <SubmitButton>{t("patients.new.submit")}</SubmitButton>
        </div>
      </form>
      </div>
    </>
  );
}

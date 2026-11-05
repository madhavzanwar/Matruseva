"use client";

import { useState, useActionState } from "react";
import type { ActionResult } from "@/app/(app)/patients/[id]/actions";
import { saveVisitAction } from "@/components/offlineActions";
import { SubmitButton } from "@/components/SubmitButton";
import { VoiceScribeModal } from "@/components/VoiceScribeModal";
import type { ParsedVitals } from "@/lib/voiceScribe";
import { Microphone, ShieldWarning, Warning, Heartbeat } from "@phosphor-icons/react";
import { buttonSecondary } from "@/components/ui";
import { useT } from "@/lib/i18n/provider";
import { toISODate, todayInClinicTimezone } from "@/lib/today";

const initialState: ActionResult = { error: null };
const inputClass =
  "num min-h-9 w-full rounded-[var(--radius-buttons)] border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2.5 py-1 text-[13px] text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-semibold text-[var(--color-charcoal)]";

export function VisitForm({ patientId }: { patientId: string }) {
  const t = useT();
  const [state, formAction] = useActionState(saveVisitAction(patientId), initialState);
  const [isVoiceOpen, setIsVoiceOpen] = useState(false);

  // Controlled values for live CDSS protocol evaluation and voice auto-fill
  const [visitDate, setVisitDate] = useState(() => toISODate(todayInClinicTimezone()));
  const [bpSys, setBpSys] = useState<string>("");
  const [bpDia, setBpDia] = useState<string>("");
  const [weight, setWeight] = useState<string>("");
  const [hb, setHb] = useState<string>("");
  const [fhr, setFhr] = useState<string>("");
  const [fundalHeight, setFundalHeight] = useState<string>("");
  const [nextVisitDate, setNextVisitDate] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const handleApplyVoiceVitals = (v: ParsedVitals) => {
    if (v.bpSys) setBpSys(String(v.bpSys));
    if (v.bpDia) setBpDia(String(v.bpDia));
    if (v.weight) setWeight(String(v.weight));
    if (v.hb) setHb(String(v.hb));
    if (v.fhr) setFhr(String(v.fhr));
    if (v.fundalHeight) setFundalHeight(String(v.fundalHeight));

    if (v.symptoms.length > 0) {
      const symptomNote = t("visits.form.voiceNote", { symptoms: v.symptoms.join(", ") });
      setNotes((prev) => (prev ? `${prev}\n${symptomNote}` : symptomNote));
    }
  };

  const sysNum = Number(bpSys);
  const diaNum = Number(bpDia);
  const hbNum = Number(hb);
  const fhrNum = Number(fhr);

  const isSevereHTN = sysNum >= 160 || diaNum >= 110;
  const isGestationalHTN = (sysNum >= 140 || diaNum >= 90) && !isSevereHTN;
  const isSevereAnemia = hbNum > 0 && hbNum < 7.0;
  const isAbnormalFHR = fhrNum > 0 && (fhrNum < 110 || fhrNum > 160);

  return (
    <div className="space-y-3">
      {/* Voice Scribe Bar */}
      <div className="flex items-center justify-between rounded-[var(--radius-cards)] border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-primary-surface)] text-[var(--color-primary)]">
            <Microphone size={15} weight="bold" />
          </div>
          <div>
            <div className="text-[12px] font-semibold text-[var(--color-foreground)]">
              {t("visits.scribe.barTitle")}
            </div>
            <div className="text-[10px] text-[var(--color-charcoal)]">
              {t("visits.scribe.barHint")}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsVoiceOpen(true)}
          className={`${buttonSecondary} min-h-8 px-3 text-[12px] gap-1.5`}
        >
          <Microphone size={14} weight="bold" className="text-[var(--color-primary)]" />
          <span>{t("visits.scribe.dictate")}</span>
        </button>
      </div>

      <VoiceScribeModal
        isOpen={isVoiceOpen}
        onClose={() => setIsVoiceOpen(false)}
        onApplyVitals={handleApplyVoiceVitals}
      />

      {/* Clinical Decision Support (CDSS) Dynamic Alert Banners */}
      {(isSevereHTN || isGestationalHTN || isSevereAnemia || isAbnormalFHR) && (
        <div className="space-y-1.5 animate-in fade-in duration-150">
          {isSevereHTN && (
            <div className="flex items-start gap-2 rounded-[var(--radius-cards)] border border-[var(--color-overdue)]/40 bg-[var(--color-overdue-surface)] p-2.5 text-[11px] text-[var(--color-foreground)]">
              <ShieldWarning size={16} weight="fill" className="shrink-0 text-[var(--color-overdue)] mt-0.5" />
              <div>
                <strong className="font-bold uppercase tracking-wider block text-[var(--color-overdue)]">
                  {t("visits.cdss.severeHtnTitle", { sys: sysNum, dia: diaNum })}
                </strong>
                {t("visits.cdss.severeHtnBody")}
              </div>
            </div>
          )}

          {isGestationalHTN && (
            <div className="flex items-start gap-2 rounded-[var(--radius-cards)] border border-[var(--color-due)]/40 bg-[var(--color-due-surface)] p-2.5 text-[11px] text-[var(--color-foreground)]">
              <Warning size={15} weight="fill" className="shrink-0 text-[var(--color-due)] mt-0.5" />
              <div>
                <strong className="font-bold block text-[var(--color-due)]">{t("visits.cdss.gHtnTitle", { sys: sysNum, dia: diaNum })}</strong>
                {t("visits.cdss.gHtnBody")}
              </div>
            </div>
          )}

          {isSevereAnemia && (
            <div className="flex items-start gap-2 rounded-[var(--radius-cards)] border border-[var(--color-overdue)]/40 bg-[var(--color-overdue-surface)] p-2.5 text-[11px] text-[var(--color-foreground)]">
              <ShieldWarning size={16} weight="fill" className="shrink-0 text-[var(--color-overdue)] mt-0.5" />
              <div>
                <strong className="font-bold uppercase tracking-wider block text-[var(--color-overdue)]">
                  {t("visits.cdss.severeAnaemiaTitle", { hb: hbNum })}
                </strong>
                {t("visits.cdss.severeAnaemiaBody")}
              </div>
            </div>
          )}

          {isAbnormalFHR && (
            <div className="flex items-start gap-2 rounded-[var(--radius-cards)] border border-[var(--color-due)]/40 bg-[var(--color-due-surface)] p-2.5 text-[11px] text-[var(--color-foreground)]">
              <Heartbeat size={16} weight="fill" className="shrink-0 text-[var(--color-due)] mt-0.5" />
              <div>
                <strong className="font-bold block text-[var(--color-due)]">{t("visits.cdss.fhrTitle", { fhr: fhrNum })}</strong>
                {t("visits.cdss.fhrBody")}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Form */}
      <form action={formAction} className="grid grid-cols-2 gap-x-2 gap-y-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4" noValidate>
        <div>
          <label htmlFor="visitDate" className={labelClass}>
            {t("visits.form.visitDate")}
          </label>
          <input
            id="visitDate"
            name="visitDate"
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bpSys" className={labelClass}>
            {t("visits.form.bpSys")}
          </label>
          <input
            id="bpSys"
            name="bpSys"
            type="number"
            value={bpSys}
            onChange={(e) => setBpSys(e.target.value)}
            placeholder="120"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bpDia" className={labelClass}>
            {t("visits.form.bpDia")}
          </label>
          <input
            id="bpDia"
            name="bpDia"
            type="number"
            value={bpDia}
            onChange={(e) => setBpDia(e.target.value)}
            placeholder="80"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="weight" className={labelClass}>
            {t("visits.form.weight")}
          </label>
          <input
            id="weight"
            name="weight"
            type="number"
            step="0.1"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="54.0"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="hb" className={labelClass}>
            {t("visits.form.hb")}
          </label>
          <input
            id="hb"
            name="hb"
            type="number"
            step="0.1"
            value={hb}
            onChange={(e) => setHb(e.target.value)}
            placeholder="11.5"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fhr" className={labelClass}>
            {t("visits.form.fhr")}
          </label>
          <input
            id="fhr"
            name="fhr"
            type="number"
            value={fhr}
            onChange={(e) => setFhr(e.target.value)}
            placeholder="140"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fundalHeight" className={labelClass}>
            {t("visits.form.fundalHeight")}
          </label>
          <input
            id="fundalHeight"
            name="fundalHeight"
            type="number"
            step="0.1"
            value={fundalHeight}
            onChange={(e) => setFundalHeight(e.target.value)}
            placeholder="28"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="nextVisitDate" className={labelClass}>
            {t("visits.form.nextVisit")}
          </label>
          <input
            id="nextVisitDate"
            name="nextVisitDate"
            type="date"
            value={nextVisitDate}
            onChange={(e) => setNextVisitDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="col-span-2 sm:col-span-4 xl:col-span-2 2xl:col-span-4">
          <label htmlFor="notes" className={labelClass}>
            {t("visits.form.notes")}
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("visits.form.notesPlaceholder")}
            className={inputClass.replace("num ", "")}
          />
        </div>

        {state.error && (
          <p role="alert" className="col-span-2 text-[13px] text-[var(--color-overdue)] sm:col-span-4 xl:col-span-2 2xl:col-span-4 font-semibold">
            {state.error}
          </p>
        )}

        <div className="col-span-2 sm:col-span-4 xl:col-span-2 2xl:col-span-4">
          <SubmitButton>{t("visits.form.save")}</SubmitButton>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import {
  ShieldCheck,
  WarningCircle,
  FileText,
  ArrowsClockwise,
  CalendarCheck,
  Stethoscope,
} from "@phosphor-icons/react";
import { applyStandardFogsiSchedule } from "@/app/(app)/settings/actions";
import {
  FOGSI_MOHFW_SCHEDULE_ITEMS,
  CLINICAL_RISK_THRESHOLDS,
  CLINICAL_SIGN_OFF_METADATA,
} from "@/lib/clinicalProtocols";
import { useT, useLocale } from "@/lib/i18n/provider";
import { formatDate } from "@/lib/format";
import { careEventName } from "@/lib/clinicalLabels";

export function ClinicalProtocolSignOff() {
  const t = useT();
  const locale = useLocale();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [showRationales, setShowRationales] = useState(false);

  const handleApplyCertifiedSchedule = () => {
    startTransition(async () => {
      const res = await applyStandardFogsiSchedule();
      if (res.error) {
        setStatusMessage(t("settings.signoff.error", { error: res.error }));
      } else {
        setStatusMessage(t("settings.signoff.applied"));
        setTimeout(() => setStatusMessage(null), 5000);
      }
    });
  };

  return (
    <div className="space-y-3.5">
      {/* Accreditation Header Card */}
      <div className="rounded-xl border border-[var(--color-primary)]/40 bg-[var(--color-primary-surface)] p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center bg-[var(--color-primary)] text-white">
              <ShieldCheck size={18} weight="fill" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-semibold text-[var(--color-foreground)]">
                  {t("settings.signoff.title")}
                </h4>
                <span className="rounded-xl flex items-center gap-1 bg-white px-2 py-0.5 text-[11px] font-bold text-[var(--color-primary)] border border-[var(--color-primary)]/30">
                  <WarningCircle size={13} weight="fill" />
                  {t("settings.signoff.statusPending")}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-foreground)]">
                {t("settings.signoff.accredited")}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-charcoal)]">
                <span>
                  <strong>{t("settings.signoff.standard")}</strong> {CLINICAL_SIGN_OFF_METADATA.version}
                </span>
                <span>
                  <strong>{t("settings.signoff.lastAudit")}</strong> {formatDate(CLINICAL_SIGN_OFF_METADATA.lastReviewed, locale)}
                </span>
                <span>
                  <strong>{t("settings.signoff.signatory")}</strong>{" "}
                  {CLINICAL_SIGN_OFF_METADATA.certifiedBy ?? t("settings.signoff.signatoryName")}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={isPending}
            onClick={handleApplyCertifiedSchedule}
            className="rounded-xl flex items-center gap-1.5 border border-[var(--color-primary)] bg-[var(--color-primary)] px-3 py-1.5 text-[12px] font-semibold text-white shadow-xs hover:bg-[var(--color-primary-hover)] disabled:opacity-50 transition-colors cursor-pointer"
          >
            <ArrowsClockwise size={14} className={isPending ? "animate-spin" : ""} />
            <span>{t("settings.signoff.apply")}</span>
          </button>
        </div>

        {statusMessage && (
          <div className="rounded-xl mt-3 border border-[#16a34a]/30 bg-[#F0FDF4] p-2 text-[12px] font-medium text-[#166534]">
            {statusMessage}
          </div>
        )}
      </div>

      {/* Protocol Pillars Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--color-foreground)] mb-1">
            <CalendarCheck size={15} className="text-[var(--color-primary)]" />
            <span>{t("settings.signoff.governanceTitle")}</span>
          </div>
          <p className="text-[11px] text-[var(--color-charcoal)] leading-relaxed">
            {t("settings.signoff.governanceBody")}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-1)] p-2.5">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--color-foreground)] mb-1">
            <Stethoscope size={15} className="text-[var(--color-primary)]" />
            <span>{t("settings.signoff.riskTitle")}</span>
          </div>
          <p className="text-[11px] text-[var(--color-charcoal)] leading-relaxed">
            {t("settings.signoff.riskBody", {
              atRisk: CLINICAL_RISK_THRESHOLDS.atRiskDays,
              lost: CLINICAL_RISK_THRESHOLDS.lostDays,
            })}
          </p>
        </div>
      </div>

      {/* Accordion Toggle for Clinical Rationales */}
      <div className="border border-[var(--color-border)] bg-[var(--color-background)]">
        <button
          type="button"
          onClick={() => setShowRationales((v) => !v)}
          className="flex w-full items-center justify-between p-2.5 text-left text-[12px] font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-surface-1)]"
        >
          <span className="flex items-center gap-1.5">
            <FileText size={15} className="text-[var(--color-primary)]" />
            <span>{t("settings.signoff.rationales")}</span>
          </span>
          <span className="text-[11px] text-[var(--color-charcoal)]">
            {showRationales ? t("settings.signoff.hide") : t("settings.signoff.show")}
          </span>
        </button>

        {showRationales && (
          <div className="border-t border-[var(--color-border)] p-3 space-y-2.5 text-[12px] max-h-72 overflow-y-auto">
            {FOGSI_MOHFW_SCHEDULE_ITEMS.map((item) => (
              <div key={item.code} className="border-b border-[var(--color-border)] pb-2 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-1">
                  <span className="font-semibold text-[var(--color-foreground)]">
                    {careEventName(item.name, t)}
                  </span>
                  <span className="num font-mono text-[11px] font-medium text-[var(--color-primary)]">
                    {t("settings.signoff.weeks", { start: item.windowStartWeek, end: item.windowEndWeek })}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--color-charcoal)]">
                  {item.clinicalRationale}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

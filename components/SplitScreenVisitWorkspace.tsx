"use client";

import { useState, useActionState, useEffect } from "react";
import { toISODate, todayInClinicTimezone } from "@/lib/today";
import {
  X,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  FileText,
  FilePdf,
  Check,
  ClipboardText,
  Columns,
  Warning,
} from "@phosphor-icons/react";
import type { ActionResult } from "@/app/(app)/patients/[id]/actions";
import { saveVisitAction } from "@/components/offlineActions";
import { SubmitButton } from "@/components/SubmitButton";
import { bpFlag, hbFlag, fhrFlag } from "@/lib/clinical";
import { formatShortDate } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/provider";
import { flagLabel } from "@/lib/clinical";
import type { MessageKey } from "@/lib/i18n/messages";

export interface PatientDocument {
  id: string;
  doc_type: string;
  doc_date: string | null;
  storage_path: string;
  ocr_text: string | null;
  url: string | null;
  created_at: string;
}

interface SplitScreenVisitWorkspaceProps {
  patientId: string;
  patientName: string;
  gaLabel: string | null;
  documents: PatientDocument[];
  initialDocId?: string | null;
  isOpen: boolean;
  onClose: () => void;
}

const initialState: ActionResult = { error: null };
const inputClass =
  "num min-h-9 w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 py-1 text-[14px] focus:border-[var(--color-primary)]";
const labelClass = "mb-1 block text-[12px] font-medium text-[var(--color-charcoal)]";

const DOC_TYPE_KEYS: Record<string, MessageKey> = {
  report: "clinical.docTypeLong.report",
  scan: "clinical.docTypeLong.scan",
  prescription: "clinical.docTypeLong.prescription",
  case_paper: "clinical.docTypeLong.case_paper",
  register_page: "clinical.docTypeLong.register_page",
  other: "clinical.docTypeLong.other",
};

export function SplitScreenVisitWorkspace({
  patientId,
  patientName,
  gaLabel,
  documents,
  initialDocId,
  isOpen,
  onClose,
}: SplitScreenVisitWorkspaceProps) {
  const t = useT();
  const locale = useLocale();
  const docLabel = (type: string) => (DOC_TYPE_KEYS[type] ? t(DOC_TYPE_KEYS[type]) : type);
  const [selectedDocId, setSelectedDocId] = useState<string>(
    initialDocId ?? (documents[0]?.id || "")
  );
  const [zoom, setZoom] = useState<number>(1);
  const [showOcr, setShowOcr] = useState<boolean>(false);
  const [copiedOcr, setCopiedOcr] = useState<boolean>(false);

  // Form states for real-time clinical checks
  const [bpSys, setBpSys] = useState<string>("");
  const [bpDia, setBpDia] = useState<string>("");
  const [hb, setHb] = useState<string>("");
  const [fhr, setFhr] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [state, formAction] = useActionState(saveVisitAction(patientId), initialState);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentDoc = documents.find((d) => d.id === selectedDocId) ?? documents[0];
  const isImage = currentDoc ? /\.(jpe?g|png|webp)$/i.test(currentDoc.storage_path) : false;

  // Real-time clinical alerts
  const sysNum = bpSys ? parseInt(bpSys, 10) : null;
  const diaNum = bpDia ? parseInt(bpDia, 10) : null;
  const hbNum = hb ? parseFloat(hb) : null;
  const fhrNum = fhr ? parseInt(fhr, 10) : null;

  const currentBpAlert = bpFlag(sysNum, diaNum);
  const currentHbAlert = hbFlag(hbNum);
  const currentFhrAlert = fhrFlag(fhrNum);

  const handleCopyOcrToNotes = () => {
    if (!currentDoc?.ocr_text) return;
    const textSnippet = t("visits.split.ocrNotePrefix", { text: currentDoc.ocr_text.slice(0, 300) });
    setNotes((prev) => (prev ? `${prev}\n${textSnippet}` : textSnippet));
    setCopiedOcr(true);
    setTimeout(() => setCopiedOcr(false), 1500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("visits.split.dialogAria")}
      className="fixed inset-0 z-50 flex flex-col bg-black/60 backdrop-blur-xs"
    >
      {/* Workspace Header */}
      <header className="flex h-14 items-center justify-between border-b border-[var(--color-border-strong)] bg-[var(--color-rail)] px-4 text-white">
        <div className="flex items-center gap-3">
          <Columns size={20} className="text-[var(--color-rail-accent)]" aria-hidden />
          <div>
            <h2 className="text-[14px] font-semibold flex items-center gap-2">
              <span>{t("visits.split.title")}</span>
              <span className="text-[12px] font-normal text-[var(--color-rail-text)]">
                · {patientName} {gaLabel ? `(${gaLabel})` : ""}
              </span>
            </h2>
          </div>
        </div>

        {/* Right Header Actions */}
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] text-[var(--color-rail-text)]">
            {t("visits.split.hint")}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center border border-white/20 text-white hover:bg-white/10"
            aria-label={t("visits.split.closeAria")}
            title={t("visits.split.closeTitle")}
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[var(--color-border)] overflow-hidden bg-[var(--color-canvas)]">
        {/* =========================================================================
            LEFT HALF: Document Viewer & OCR Drawer
            ========================================================================= */}
        <div className="flex flex-col h-full overflow-hidden bg-[var(--color-surface-2)]">
          {/* Document selection bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <span className="text-[12px] font-medium text-[var(--color-charcoal)]">
                {t("visits.split.document")}
              </span>
              {documents.length > 0 ? (
                <select
                  value={selectedDocId}
                  onChange={(e) => {
                    setSelectedDocId(e.target.value);
                    setZoom(1);
                  }}
                  className="rounded-xl min-h-8 border border-[var(--color-border-strong)] bg-[var(--color-background)] px-2 text-[13px] font-medium text-[var(--color-foreground)] flex-1 max-w-xs"
                >
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {docLabel(d.doc_type)} · {formatShortDate(d.doc_date ?? d.created_at, locale)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-[12px] text-[var(--color-charcoal)]">{t("visits.split.noDocs")}</span>
              )}
            </div>

            {/* Viewer Controls */}
            {currentDoc && (
              <div className="flex items-center gap-1">
                {isImage && (
                  <>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
                      className="flex h-8 w-8 items-center justify-center border border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-1)] text-[var(--color-foreground)]"
                      title={t("visits.split.zoomOut")}
                      aria-label={t("visits.split.zoomOut")}
                    >
                      <MagnifyingGlassMinus size={15} />
                    </button>
                    <span className="num px-1.5 text-[11px] text-[var(--color-charcoal)]">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
                      className="flex h-8 w-8 items-center justify-center border border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-1)] text-[var(--color-foreground)]"
                      title={t("visits.split.zoomIn")}
                      aria-label={t("visits.split.zoomIn")}
                    >
                      <MagnifyingGlassPlus size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(1)}
                      className="rounded-xl h-8 px-2 border border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-1)] text-[11px] text-[var(--color-charcoal)]"
                      title={t("visits.split.zoomReset")}
                    >
                      {t("visits.split.reset")}
                    </button>
                  </>
                )}

                {currentDoc.ocr_text && (
                  <button
                    type="button"
                    onClick={() => setShowOcr((s) => !s)}
                    className={`h-8 px-2.5 border text-[11px] font-medium flex items-center gap-1.5 ${
                      showOcr
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                        : "border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-surface-1)] text-[var(--color-foreground)]"
                    }`}
                  >
                    <FileText size={14} />
                    {showOcr ? t("visits.split.hideOcr") : t("visits.split.viewOcr")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Document Content Viewport */}
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center relative">
            {currentDoc ? (
              isImage && currentDoc.url ? (
                <div
                  className="transition-transform duration-100 flex items-center justify-center min-h-full"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentDoc.url}
                    alt={t("visits.split.imageAlt")}
                    className="max-w-full max-h-[70vh] object-contain shadow-md border border-[var(--color-border)] bg-black"
                  />
                </div>
              ) : currentDoc.url ? (
                <div className="w-full h-full min-h-[400px] border border-[var(--color-border)] bg-white shadow-xs">
                  <iframe
                    src={currentDoc.url}
                    title={t("visits.split.pdfTitle")}
                    className="w-full h-full min-h-[450px]"
                  />
                </div>
              ) : (
                <div className="text-center p-8 text-[var(--color-charcoal)]">
                  <FilePdf size={48} className="mx-auto mb-2 opacity-50" />
                  <p>{t("visits.split.urlExpired")}</p>
                </div>
              )
            ) : (
              <div className="text-center p-8 text-[var(--color-charcoal)] max-w-sm">
                <FileText size={48} className="mx-auto mb-2 opacity-40" />
                <p className="font-medium text-[14px]">{t("visits.split.noAttached")}</p>
                <p className="text-[12px] mt-1">
                  {t("visits.split.noAttachedHint")}
                </p>
              </div>
            )}

            {/* Collapsible OCR Text Panel Drawer */}
            {showOcr && currentDoc?.ocr_text && (
              <div className="rounded-xl absolute inset-x-3 bottom-3 top-auto max-h-[45%] border border-[var(--color-border-strong)] bg-[var(--color-background)] shadow-xl p-3 z-10 flex flex-col">
                <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-1.5 mb-2">
                  <span className="text-[12px] font-medium text-[var(--color-foreground)] flex items-center gap-1.5">
                    <FileText size={14} className="text-[var(--color-primary)]" />
                    {t("visits.split.ocrLayer")}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopyOcrToNotes}
                      className="inline-flex items-center gap-1 text-[11px] bg-[var(--color-primary)] text-white px-2 py-0.5 font-medium hover:bg-[var(--color-primary-hover)]"
                    >
                      {copiedOcr ? <Check size={12} /> : <ClipboardText size={12} />}
                      {copiedOcr ? t("visits.split.ocrCopied") : t("visits.split.ocrInsert")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowOcr(false)}
                      aria-label={t("visits.split.ocrClose")}
                      className="text-[var(--color-charcoal)] hover:text-black"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
                <pre className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed text-[var(--color-charcoal)] whitespace-pre-wrap bg-[var(--color-surface-1)] p-2">
                  {currentDoc.ocr_text}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* =========================================================================
            RIGHT HALF: Consultation Visit Entry Form
            ========================================================================= */}
        <div className="flex flex-col h-full overflow-y-auto bg-[var(--color-background)] p-4 sm:p-6">
          <div className="border-b border-[var(--color-border)] pb-3 mb-4">
            <h3 className="text-[16px] font-semibold text-[var(--color-foreground)]">
              {t("visits.split.entryTitle")}
            </h3>
            <p className="text-[12px] text-[var(--color-charcoal)]">
              {t("visits.split.entryHint")}
            </p>
          </div>

          {/* Real-time Clinical Alerts Banner */}
          {(currentBpAlert || currentHbAlert || currentFhrAlert) && (
            <div className="rounded-xl mb-4 p-2.5 border border-[var(--color-overdue)] bg-[var(--color-overdue-surface)] text-[12px] space-y-1">
              <div className="font-semibold text-[var(--color-overdue)] flex items-center gap-1.5">
                <Warning size={15} weight="fill" />
                {t("visits.split.abnormal")}
              </div>
              <ul className="list-disc list-inside text-[var(--color-foreground)] space-y-0.5">
                {currentBpAlert && <li>{flagLabel(currentBpAlert, t)} ({bpSys}/{bpDia} mmHg)</li>}
                {currentHbAlert && <li>{flagLabel(currentHbAlert, t)} ({hb} g/dL)</li>}
                {currentFhrAlert && <li>{flagLabel(currentFhrAlert, t)} ({fhr} bpm)</li>}
              </ul>
            </div>
          )}

          <form action={formAction} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label htmlFor="splitVisitDate" className={labelClass}>
                  {t("visits.form.visitDate")}
                </label>
                <input
                  id="splitVisitDate"
                  name="visitDate"
                  type="date"
                  defaultValue={toISODate(todayInClinicTimezone())}
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="splitBpSys" className={labelClass}>
                  {t("visits.form.bpSys")}
                </label>
                <input
                  id="splitBpSys"
                  name="bpSys"
                  type="number"
                  placeholder="120"
                  value={bpSys}
                  onChange={(e) => setBpSys(e.target.value)}
                  className={`${inputClass} ${currentBpAlert ? "border-[var(--color-overdue)] font-semibold" : ""}`}
                />
              </div>

              <div>
                <label htmlFor="splitBpDia" className={labelClass}>
                  {t("visits.form.bpDia")}
                </label>
                <input
                  id="splitBpDia"
                  name="bpDia"
                  type="number"
                  placeholder="80"
                  value={bpDia}
                  onChange={(e) => setBpDia(e.target.value)}
                  className={`${inputClass} ${currentBpAlert ? "border-[var(--color-overdue)] font-semibold" : ""}`}
                />
              </div>

              <div>
                <label htmlFor="splitWeight" className={labelClass}>
                  {t("visits.form.weight")}
                </label>
                <input
                  id="splitWeight"
                  name="weight"
                  type="number"
                  step="0.1"
                  placeholder="55.0"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="splitHb" className={labelClass}>
                  {t("visits.form.hb")}
                </label>
                <input
                  id="splitHb"
                  name="hb"
                  type="number"
                  step="0.1"
                  placeholder="11.0"
                  value={hb}
                  onChange={(e) => setHb(e.target.value)}
                  className={`${inputClass} ${currentHbAlert ? "border-[var(--color-overdue)] font-semibold" : ""}`}
                />
              </div>

              <div>
                <label htmlFor="splitFhr" className={labelClass}>
                  {t("visits.form.fhr")}
                </label>
                <input
                  id="splitFhr"
                  name="fhr"
                  type="number"
                  placeholder="140"
                  value={fhr}
                  onChange={(e) => setFhr(e.target.value)}
                  className={`${inputClass} ${currentFhrAlert ? "border-[var(--color-overdue)] font-semibold" : ""}`}
                />
              </div>

              <div>
                <label htmlFor="splitFundalHeight" className={labelClass}>
                  {t("visits.form.fundalHeight")}
                </label>
                <input
                  id="splitFundalHeight"
                  name="fundalHeight"
                  type="number"
                  step="0.1"
                  placeholder="24.0"
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="splitNextVisitDate" className={labelClass}>
                  {t("visits.form.nextVisit")}
                </label>
                <input
                  id="splitNextVisitDate"
                  name="nextVisitDate"
                  type="date"
                  className={inputClass}
                />
              </div>
            </div>

            {/* Notes Section with Quick Measurement Insertion */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="splitNotes" className={labelClass}>
                  {t("visits.split.notes")}
                </label>
                {currentDoc && (
                  <button
                    type="button"
                    onClick={() => {
                      const prefix = t("visits.split.tagText", { docType: docLabel(currentDoc.doc_type), date: formatShortDate(currentDoc.doc_date ?? currentDoc.created_at, locale) });
                      setNotes((prev) => (prev ? `${prev}\n${prefix}` : prefix));
                    }}
                    className="text-[11px] text-[var(--color-primary)] hover:underline"
                  >
                    {t("visits.split.tagDoc")}
                  </button>
                )}
              </div>
              <textarea
                id="splitNotes"
                name="notes"
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("visits.split.notesPlaceholder")}
                className="rounded-xl w-full border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] font-sans focus:border-[var(--color-primary)] outline-none"
              />
            </div>

            {state.error && (
              <p role="alert" className="text-[13px] text-[var(--color-overdue)] font-medium">
                {state.error}
              </p>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl px-3 py-2 border border-[var(--color-border-strong)] text-[13px] font-medium hover:bg-[var(--color-surface-1)]"
              >
                {t("common.cancel")}
              </button>
              <SubmitButton>{t("visits.split.save")}</SubmitButton>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

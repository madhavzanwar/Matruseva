import { FilePdf, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatShortDate } from "@/lib/format";
import { DocumentUploader } from "@/components/DocumentUploader";
import { AssignDocumentForm } from "@/components/AssignDocumentForm";
import { PageHeader, Panel, Tag, type Tone, pageBody } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

const OCR_STATUS = {
  pending: { labelKey: "documents.ocr.pending", tone: "neutral" },
  done: { labelKey: "documents.ocr.done", tone: "ok" },
  failed: { labelKey: "documents.ocr.failed", tone: "warning" },
  skipped: { labelKey: "documents.ocr.skipped", tone: "neutral" },
} as const satisfies Record<string, { labelKey: string; tone: Tone }>;

const SOURCE_KEY = {
  camera: "documents.sourceTag.camera",
  whatsapp: "documents.sourceTag.whatsapp",
  paper: "documents.sourceTag.paper",
  pdf: "documents.sourceTag.pdf",
} as const;

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, me, { t, locale }] = await Promise.all([searchParams, getCurrentUser(), getT()]);
  const searching = Boolean(q && q.trim());
  // Demo sessions have no documents; never hit Supabase.
  const supabase = me.isDemo ? null : await createClient();

  let query = supabase
    ?.from("documents")
    .select("id, doc_type, source, storage_path, ocr_status, created_at, patient_id, patients(name)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (query) query = searching ? query.textSearch("search", q!, { type: "websearch", config: "simple" }) : query.is("patient_id", null);

  const { data: documents } = query ? await query : { data: null };
  const docs = documents ?? [];
  const { data: signed } = supabase && docs.length
    ? await supabase.storage.from("documents").createSignedUrls(docs.map((d) => d.storage_path), 300)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return (
    <>
      <PageHeader title={t("documents.title")} meta={t("documents.meta")} />

      <div className={pageBody}>
        <Panel title={t("documents.upload.panel")}>
          <div className="p-4 pt-1">
            <DocumentUploader clinicId={me.clinicId} />
          </div>
        </Panel>

        <Panel
          title={searching ? t("documents.results", { query: q ?? "" }) : t("documents.inbox")}
          count={docs.length}
          action={
            <form action="/documents" className="flex items-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-background)] focus-within:border-[var(--color-primary)]">
              <MagnifyingGlass size={15} className="ml-2 text-[var(--color-charcoal)]" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder={t("documents.search.placeholder")}
                aria-label={t("documents.search.aria")}
                className="min-h-9 w-56 border-0 bg-transparent px-2 text-[13px] shadow-none outline-none focus:shadow-none"
              />
            </form>
          }
        >
          {docs.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--color-charcoal)]">
              {searching ? t("documents.empty.search") : t("documents.empty.inbox")}
            </p>
          ) : (
            <ul className="grid gap-3 px-4 pb-4 sm:grid-cols-2 xl:grid-cols-3">
              {docs.map((doc) => {
                const url = urlByPath.get(doc.storage_path) ?? null;
                const isImage = /\.(jpe?g|png|webp)$/i.test(doc.storage_path);
                const status = OCR_STATUS[(doc.ocr_status ?? "pending") as keyof typeof OCR_STATUS] ?? OCR_STATUS.pending;
                const sourceKey = SOURCE_KEY[doc.source as keyof typeof SOURCE_KEY];
                const patientName = (doc.patients as { name: string } | null)?.name;
                return (
                  <li key={doc.id} className="flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]">
                    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block">
                      {url && isImage ? (
                        // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not an optimizable static asset
                        <img src={url} alt="" loading="lazy" className="h-44 w-full object-cover" />
                      ) : (
                        <div className="flex h-44 items-center justify-center bg-[var(--color-surface-1)]">
                          <FilePdf size={40} className="text-[var(--color-charcoal)]" aria-hidden />
                        </div>
                      )}
                    </a>
                    <div className="flex flex-1 flex-col gap-2 p-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                        <span className="num text-[var(--color-charcoal)]">{formatShortDate(doc.created_at, locale)}</span>
                        <span className="text-[var(--color-charcoal)]">· {sourceKey ? t(sourceKey) : doc.source}</span>
                        <Tag tone={status.tone}>{t(status.labelKey)}</Tag>
                        {patientName && <Tag tone="info">{patientName}</Tag>}
                      </div>
                      {!doc.patient_id && <AssignDocumentForm documentId={doc.id} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

import { FilePdf, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { DocumentUploader } from "@/components/DocumentUploader";
import { PageHeader, Panel, Tag, type Tone, pageBody } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

const OCR_STATUS = {
  pending: { labelKey: "documents.ocr.pending", tone: "neutral" },
  done: { labelKey: "documents.ocr.done", tone: "ok" },
  failed: { labelKey: "documents.ocr.failed", tone: "warning" },
  skipped: { labelKey: "documents.ocr.skipped", tone: "neutral" },
} as const satisfies Record<string, { labelKey: string; tone: Tone }>;

export default async function OpdRegisterPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ q }, me, { t, locale }] = await Promise.all([searchParams, getCurrentUser(), getT()]);
  const searching = Boolean(q && q.trim());
  // Demo sessions have no register pages; never hit Supabase.
  const supabase = me.isDemo ? null : await createClient();

  let query = supabase
    ?.from("documents")
    .select("id, doc_date, storage_path, ocr_status, created_at")
    .eq("doc_type", "register_page")
    .order("doc_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (query && searching) query = query.textSearch("search", q!, { type: "websearch", config: "simple" });

  const { data: pages } = query ? await query : { data: null };
  const list = pages ?? [];
  const { data: signed } = supabase && list.length
    ? await supabase.storage.from("documents").createSignedUrls(list.map((p) => p.storage_path), 300)
    : { data: [] };
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  // Group pages by register date so a day's pages sit together.
  const byDate = new Map<string, typeof list>();
  for (const p of list) {
    const key = p.doc_date ?? "undated";
    byDate.set(key, [...(byDate.get(key) ?? []), p]);
  }

  return (
    <>
      <PageHeader
        title={t("opd.title")}
        meta={t("opd.meta")}
      />
      <div className={pageBody}>
        <Panel title={t("opd.capture.panel")}>
          <div className="p-4 pt-1">
            <DocumentUploader clinicId={me.clinicId} folder="opd-register" fixedDocType="register_page" showDateInput />
          </div>
        </Panel>

        <Panel
          title={searching ? t("opd.results", { query: q ?? "" }) : t("opd.panel")}
          count={list.length}
          action={
            <form action="/opd" className="flex items-center rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-background)] focus-within:border-[var(--color-primary)]">
              <MagnifyingGlass size={15} className="ml-2 text-[var(--color-charcoal)]" aria-hidden />
              <input
                type="search"
                name="q"
                defaultValue={q ?? ""}
                placeholder={t("opd.search.placeholder")}
                aria-label={t("opd.search.aria")}
                className="min-h-9 w-52 border-0 bg-transparent px-2 text-[13px] shadow-none outline-none focus:shadow-none"
              />
            </form>
          }
        >
          {list.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-[var(--color-charcoal)]">
              {searching ? t("opd.empty.search") : t("opd.empty.none")}
            </p>
          ) : (
            [...byDate.entries()].map(([date, datePages]) => (
              <div key={date}>
                <p className="num px-4 pb-2 pt-3 text-[13px] font-semibold">
                  {date === "undated" ? t("opd.undated") : formatDate(date, locale)}
                  <span className="ml-2 font-normal text-[var(--color-charcoal)]">
                    {t("opd.pages", { count: datePages.length })}
                  </span>
                </p>
                <ul className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-3 xl:grid-cols-5">
                  {datePages.map((p) => {
                    const url = urlByPath.get(p.storage_path) ?? null;
                    const isImage = /\.(jpe?g|png|webp)$/i.test(p.storage_path);
                    const status = OCR_STATUS[(p.ocr_status ?? "pending") as keyof typeof OCR_STATUS] ?? OCR_STATUS.pending;
                    return (
                      <li key={p.id} className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)]">
                        <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block hover:opacity-90">
                          {url && isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not an optimizable static asset
                            <img src={url} alt="" loading="lazy" className="h-40 w-full object-cover" />
                          ) : (
                            <div className="flex h-40 items-center justify-center bg-[var(--color-surface-1)]">
                              <FilePdf size={36} className="text-[var(--color-charcoal)]" aria-hidden />
                            </div>
                          )}
                        </a>
                        <div className="p-2">
                          <Tag tone={status.tone}>{t(status.labelKey)}</Tag>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </Panel>
      </div>
    </>
  );
}

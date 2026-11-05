import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getClinicSnapshot, daysOverdue, needsFollowUp, followUpPriority } from "@/lib/snapshot";
import { formatGALocalized } from "@/lib/pregnancy";
import { daysBetween, parseLocalDate } from "@/lib/format";
import {
  telLink,
  whatsAppLink,
  allLanguageMessages,
  type ReminderReason,
  type MessageTemplates,
} from "@/lib/whatsapp";
import { getDemoContacts } from "@/lib/demo-data";
import { PageHeader, pageBody } from "@/components/ui";
import { CallQueue, type CallFilter, type CallRow } from "@/components/CallQueue";
import type { ContactOutcome } from "@/lib/supabase/enums";
import { getT } from "@/lib/i18n/server";

const FILTER_IDS: CallFilter[] = ["all", "overdue", "at_risk", "lost", "pending"];

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const { t } = await getT();
  const me = await getCurrentUser();
  const supabase = me.isDemo ? null : await createClient();

  const [{ f }, { rows, today }, { data: clinic }, { data: contacts }] = await Promise.all([
    searchParams,
    getClinicSnapshot(),
    supabase
      ? supabase.from("clinics").select("name, message_templates").eq("id", me.clinicId).single()
      : { data: null },
    supabase
      ? supabase
          .from("contact_log")
          .select("patient_id, outcome, channel, created_at")
          .order("created_at", { ascending: false })
          .limit(2000)
      : { data: null },
  ]);
  const templates = (clinic?.message_templates ?? {}) as MessageTemplates;
  const defaultLang = templates.default_lang ?? "en";

  const contactsBy = new Map<string, { outcome: string; channel: string; createdAt: string }[]>();
  if (me.isDemo) {
    for (const dc of getDemoContacts()) {
      const list = contactsBy.get(dc.patientId) ?? [];
      list.push({ outcome: dc.outcome, channel: dc.channel, createdAt: dc.createdAt });
      contactsBy.set(dc.patientId, list);
    }
  }
  for (const c of contacts ?? []) {
    const list = contactsBy.get(c.patient_id) ?? [];
    list.push({ outcome: c.outcome, channel: c.channel, createdAt: c.created_at });
    contactsBy.set(c.patient_id, list);
  }

  const queue: CallRow[] = rows
    .filter(needsFollowUp)
    .sort((a, b) => followUpPriority(a, today) - followUpPriority(b, today))
    .map((r) => {
      const reason: ReminderReason = r.risk === "lost" ? "lost" : r.overdue.length > 0 ? "overdue" : "at_risk";
      const item = r.overdue[0]?.name;
      const messagesByLang = allLanguageMessages(r.name, reason, item, templates, clinic?.name);
      const whatsappByLang = {
        en: r.phone ? whatsAppLink(r.phone, messagesByLang.en) : null,
        hi: r.phone ? whatsAppLink(r.phone, messagesByLang.hi) : null,
        mr: r.phone ? whatsAppLink(r.phone, messagesByLang.mr) : null,
      };
      const history = contactsBy.get(r.id) ?? [];
      const last = history[0];
      const lastDate = last ? new Date(last.createdAt) : null;
      const lastDaysAgo = lastDate
        ? daysBetween(parseLocalDate(lastDate.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })), today)
        : null;
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        gaLabel: r.ga ? formatGALocalized(r.ga, t) : null,
        reason,
        overdueItems: r.overdue.map((e) => e.name),
        overdueDays: daysOverdue(r, today),
        flags: r.flags.filter((fl) => fl.severity !== "info"),
        noAnswerStreak: r.noAnswerStreak,
        attempts30d: history.filter((h) => daysBetween(new Date(h.createdAt), today) <= 30).length,
        lastContact: last
          ? { outcome: last.outcome as ContactOutcome, channel: last.channel, daysAgo: lastDaysAgo ?? 0 }
          : null,
        tel: r.phone ? telLink(r.phone) : null,
        whatsapp: whatsappByLang[defaultLang],
        whatsappByLang,
        messagesByLang,
      };
    });

  const initialFilter = FILTER_IDS.includes(f as CallFilter) ? (f as CallFilter) : "all";
  const pending = queue.filter((q) => q.lastContact?.daysAgo !== 0).length;

  return (
    <>
      <PageHeader
        title={t("calls.title")}
        meta={
          <span className="num">
            {t("calls.meta.needFollowUp", { count: queue.length })} · {t("calls.meta.notContacted", { count: pending })}
          </span>
        }
      />
      <div className={pageBody}>
        <CallQueue rows={queue} initialFilter={initialFilter} defaultLang={defaultLang} />
      </div>
    </>
  );
}

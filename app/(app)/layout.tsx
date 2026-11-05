import { Suspense } from "react";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { AppTopBar, AppBottomNav } from "@/components/AppNav";
import { AppShell } from "@/components/AppShell";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";
import { CallQueueBadge } from "@/components/CallQueueBadge";
import { CommandPalette } from "@/components/CommandPalette";
import { Toaster } from "@/components/Toaster";
import { OfflineSync } from "@/components/OfflineSync";
import { getLocale } from "@/lib/i18n/server";
import { messages } from "@/lib/i18n/messages";
import { AppI18nProvider } from "./AppI18nProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [me, cookieStore, locale] = await Promise.all([getCurrentUser(), cookies(), getLocale()]);
  const collapsed = cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <AppI18nProvider locale={locale} messages={messages[locale]}>
    <AppShell initialCollapsed={collapsed}>
      <AppTopBar
        clinicName={me.clinicName}
        userName={me.fullName}
        isDoctor={me.role === "doctor"}
        callBadge={
          <Suspense fallback={null}>
            <CallQueueBadge />
          </Suspense>
        }
      />
      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      <AppBottomNav />
      <CommandPalette isDemo={me.isDemo} />
      <Toaster />
      <OfflineSync userId={me.userId} />
    </AppShell>
    </AppI18nProvider>
  );
}

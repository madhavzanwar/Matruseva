import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { getLocale, getT } from "@/lib/i18n/server";
import { messagesForAreas } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/provider";

const body = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// IBM Plex Sans has no Devanagari glyphs; this is the per-glyph fallback for
// Hindi/Marathi (see --font-body stack in globals.css). Not preloaded so English
// users never pay for it; the browser fetches it only when Devanagari renders.
const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    title: "MatruSetu",
    description: t("shell.meta.description"),
    manifest: "/manifest.webmanifest",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#3e2a5c",
};

// Client components on public pages (auth forms, LanguageSwitcher, listen player) only need these;
// the signed-in (app) layout supplies the full dictionary.
const PUBLIC_AREAS = ["common", "auth", "shell"] as const;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${body.variable} ${mono.variable} ${devanagari.variable} h-full antialiased`}
    >
      <body className="min-h-dvh flex flex-col">
        <I18nProvider locale={locale} messages={messagesForAreas(locale, PUBLIC_AREAS)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}

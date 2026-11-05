"use client";

import { I18nProvider } from "@/lib/i18n/provider";

// Lives in the (app) tree so the full dictionary only ships to signed-in pages.
export { I18nProvider as AppI18nProvider };

import { common } from "./common";
import { shell } from "./shell";
import { auth } from "./auth";
import { landing } from "./landing";
import { today } from "./today";
import { patients } from "./patients";
import { patientDetail } from "./patient-detail";
import { visits } from "./visits";
import { reports } from "./reports";
import { calls } from "./calls";
import { documents } from "./documents";
import { opd } from "./opd";
import { settings } from "./settings";
import { clinical } from "./clinical";
import type { Locale } from "../config";

import * as commonMod from "./common";
import * as shellMod from "./shell";
import * as authMod from "./auth";
import * as landingMod from "./landing";
import * as todayMod from "./today";
import * as patientsMod from "./patients";
import * as patientDetailMod from "./patient-detail";
import * as visitsMod from "./visits";
import * as reportsMod from "./reports";
import * as callsMod from "./calls";
import * as documentsMod from "./documents";
import * as opdMod from "./opd";
import * as settingsMod from "./settings";
import * as clinicalMod from "./clinical";

/** Every area, by name. To add an area, add its file and one line here. */
export const AREAS = {
  common,
  shell,
  auth,
  landing,
  today,
  patients,
  patientDetail,
  visits,
  reports,
  calls,
  documents,
  opd,
  settings,
  clinical,
} as const;

/** Each area file's optional `untranslated` allow-list (parity test unions these). */
export const AREA_UNTRANSLATED: Record<keyof typeof AREAS, readonly string[]> = {
  common: commonMod.untranslated,
  shell: shellMod.untranslated,
  auth: authMod.untranslated,
  landing: landingMod.untranslated,
  today: todayMod.untranslated,
  patients: patientsMod.untranslated,
  patientDetail: patientDetailMod.untranslated,
  visits: visitsMod.untranslated,
  reports: reportsMod.untranslated,
  calls: callsMod.untranslated,
  documents: documentsMod.untranslated,
  opd: opdMod.untranslated,
  settings: settingsMod.untranslated,
  clinical: clinicalMod.untranslated,
};

type Areas = (typeof AREAS)[keyof typeof AREAS];
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
type AllEn = UnionToIntersection<Areas["en"]>;
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type StripPlural<K> = K extends `${infer B}_${PluralSuffix}` ? B : K;

/** Every raw catalogue key, including `_one`/`_other` plural variants. */
export type RawMessageKey = keyof AllEn & string;
/** Keys callers pass to t(): plural variants collapse to their base key. */
export type MessageKey = StripPlural<RawMessageKey>;

function merge(locale: Locale): Record<string, string> {
  const out: Record<string, string> = {};
  for (const area of Object.values(AREAS)) Object.assign(out, area[locale]);
  return out;
}

/** Merged catalogue per locale (all areas). Server/tests only; clients get one locale via the provider. */
export const messages: Record<Locale, Record<string, string>> = {
  en: merge("en"),
  hi: merge("hi"),
  mr: merge("mr"),
};

/** Merged catalogue for just the named areas, so public pages ship a small dictionary. */
export function messagesForAreas(locale: Locale, names: readonly (keyof typeof AREAS)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) Object.assign(out, AREAS[n][locale]);
  return out;
}

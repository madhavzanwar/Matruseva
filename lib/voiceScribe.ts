/**
 * Voice-to-Vitals NLP Parser for Frontline ASHA and ANM Workers.
 * Parses spoken English, Hindi, Marathi, and Hinglish clinical dictations
 * into structured maternal vitals and clinical symptom observations.
 */

import { canonicalizeDevanagari, detectDevanagariSymptoms, CLINICAL_KEYTERMS } from "@/lib/voiceScribeDevanagari";

export { CLINICAL_KEYTERMS };

export interface ParsedVitals {
  bpSys: number | null;
  bpDia: number | null;
  weight: number | null;
  hb: number | null;
  fhr: number | null;
  fundalHeight: number | null;
  symptoms: string[];
  rawTranscript: string;
}

// Map Hindi number words to digits
const HINDI_NUMBERS: Record<string, number> = {
  // 0-20
  "shunya": 0, "ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5,
  "chhe": 6, "che": 6, "saat": 7, "aath": 8, "ath": 8, "nau": 9, "das": 10,
  "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14, "pandrah": 15,
  "solah": 16, "satrah": 17, "atharah": 18, "unnis": 19, "bees": 20,
  // 21-40
  "ikhees": 21, "baees": 22, "teees": 23, "chaubees": 24, "pachhees": 25,
  "chhabees": 26, "sattaees": 27, "atthaees": 28, "untees": 29, "tees": 30,
  "ikatees": 31, "battees": 32, "tentees": 33, "chautees": 34, "paintees": 35,
  "chhattees": 36, "saintees": 37, "adtees": 38, "untalees": 39, "chalis": 40, "chaalees": 40,
  // 41-60
  "iktaalees": 41, "bayaalees": 42, "tentaalees": 43, "chauwaalees": 44, "paintaalees": 45,
  "chhiyaalees": 46, "saintaalees": 47, "adtaalees": 48, "unchaas": 49, "pachaas": 50,
  "ikyaawan": 51, "baawan": 52, "bawan": 52, "tirepan": 53, "chawwan": 54, "pachpan": 55,
  "chhappan": 56, "sattawan": 57, "atthaawan": 58, "unsath": 59, "saath": 60,
  // 61-90
  "iksath": 61, "baasath": 62, "tirasath": 63, "chausath": 64, "painsath": 65,
  "chhiyaasath": 66, "sadsath": 67, "adsath": 68, "unhattar": 69, "sattar": 70,
  "ikhattar": 71, "bahattar": 72, "tihattar": 73, "chauhattar": 74, "pachhattar": 75,
  "chhihattar": 76, "satattar": 77, "athattar": 78, "unasi": 79, "assi": 80,
  "ikyaasi": 81, "bayaasi": 82, "tiraasi": 83, "chauraasi": 84, "pachaasi": 85,
  "chhiyaasi": 86, "sattaasi": 87, "atthaasi": 88, "nawaasi": 89, "nabbe": 90, "nave": 90,
  // 91-100
  "ikyaanwe": 91, "baanwe": 92, "tiraanwe": 93, "chauraanwe": 94, "pachaanwe": 95,
  "chhiyaanwe": 96, "sattaanwe": 97, "atthaanwe": 98, "ninyaanwe": 99, "sau": 100,
  // Compound multiples:
  "ek sau tees": 130, "ek sau chaalees": 140, "ek sau pachaas": 150, "ek sau bees": 120, "ek sau das": 110,
};

/** Normalize spoken transcription into cleaner numeric tokens */
function normalizeTranscript(text: string): string {
  // Devanagari (Hindi/Marathi, as returned by Gnani Prisma) is first rewritten into the
  // canonical Latin/digit form below; pure Latin input passes through unchanged.
  let normalized = canonicalizeDevanagari(text)
    .replace(/[,\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Replace common Hindi spoken phrase numbers: e.g. "ek sau tees" -> "130"
  normalized = normalized
    .replace(/ek sau\s+chaalees/g, "140")
    .replace(/ek sau\s+chalis/g, "140")
    .replace(/ek sau\s+tees/g, "130")
    .replace(/ek sau\s+bees/g, "120")
    .replace(/ek sau\s+das/g, "110")
    .replace(/ek sau\s+pachaas/g, "150")
    .replace(/ek sau\s+saath/g, "160")
    .replace(/ek sau\s+pachees/g, "125")
    .replace(/ek sau\s+paintees/g, "135");

  // Replace decimal phrases e.g. "9 point 5", "nau dashamalav paanch"
  normalized = normalized
    .replace(/point|dashamalav|dashamlav|dash/g, ".")
    .replace(/\s*\.\s*/g, ".");

  // Replace Hindi single number words if isolated
  for (const [word, val] of Object.entries(HINDI_NUMBERS)) {
    const regex = new RegExp(`\\b${word}\\b`, "g");
    normalized = normalized.replace(regex, String(val));
  }

  return normalized;
}

/**
 * Parses spoken clinical dictation into structured vitals.
 */
export function parseVoiceToVitals(rawText: string): ParsedVitals {
  const norm = normalizeTranscript(rawText);
  let bpSys: number | null = null;
  let bpDia: number | null = null;
  let weight: number | null = null;
  let hb: number | null = null;
  let fhr: number | null = null;
  let fundalHeight: number | null = null;
  const symptoms: string[] = [];

  // 1. Blood Pressure: "BP 130 80", "BP 140/90", "130 over 85", "120 80"
  // Keyword-anchored match first ("bp 130 80"), then the legacy un-anchored pair.
  const bpMatch =
    norm.match(/(?:\bbp\b|blood pressure|\bb p\b|rakta chaap)\s*(?:is|=|:)?\s*(\d{2,3})\s*(?:\/|over|by|aur|and|\s+)\s*(\d{2,3})(?!\d)/i) ??
    norm.match(/(?:bp|blood pressure|b p|rakta chaap)?\s*(\d{2,3})\s*(?:\/|over|by|aur|and|\s+)\s*(\d{2,3})/i);
  if (bpMatch) {
    const sys = parseInt(bpMatch[1], 10);
    const dia = parseInt(bpMatch[2], 10);
    if (sys >= 60 && sys <= 260 && dia >= 30 && dia <= 160 && sys > dia) {
      bpSys = sys;
      bpDia = dia;
    }
  }

  // 2. Weight: "weight 54", "vajan 54", "54 kg", "54 kilo"
  const weightMatch = norm.match(/(?:weight|vajan|wazan|vazan|bhaar)\s*(?:is|=|:)?\s*(?:kg|kilo)?\s*(\d{2,3}(?:\.\d+)?)|(\d{2,3}(?:\.\d+)?)\s*(?:kg|kilo|kilogram)/i);
  if (weightMatch) {
    const val = parseFloat(weightMatch[1] || weightMatch[2]);
    if (val >= 30 && val <= 200) {
      weight = Math.round(val * 10) / 10;
    }
  }

  // 3. Hemoglobin (Hb): "hb 9.5", "hemoglobin 10.2", "hb is 11", "hemoglobin 9"
  const hbMatch = norm.match(/(?:hb|hemoglobin|haemoglobin|hemo|haemo|khoon)\s*(?:is|=|:)?\s*(\d{1,2}(?:\.\d+)?)(?!\d)/i);
  if (hbMatch) {
    const val = parseFloat(hbMatch[1]);
    if (val >= 3 && val <= 20) {
      hb = Math.round(val * 10) / 10;
    }
  }

  // 4. Fetal Heart Rate (FHR): "fhr 142", "heart rate 138", "fetal heart 140", "dhadkan 140"
  const fhrMatch = norm.match(/(?:fhr|fetal heart|heart rate|dhadkan)\s*(?:is|=|:)?\s*(\d{2,3})/i);
  if (fhrMatch) {
    const val = parseInt(fhrMatch[1], 10);
    if (val >= 80 && val <= 200) {
      fhr = val;
    }
  }

  // 5. Fundal Height: "fundal height 28", "fundal 30", "height 26"
  const fhMatch = norm.match(/(?:fundal height|fundal|sfh)\s*(?:is|=|:)?\s*(\d{1,2})(?:\.\d+)?(?!\d)/i);
  if (fhMatch) {
    const val = parseInt(fhMatch[1], 10);
    if (val >= 10 && val <= 45) {
      fundalHeight = val;
    }
  }

  // 6. Symptoms detection (Vernacular English, Hindi & Marathi keywords)
  const symptomPatterns: { label: string; keywords: string[] }[] = [
    { label: "Pedal Edema (Swelling)", keywords: ["swelling", "edema", "sujan", "sooj", "paanv", "pairon mein sujan", "payaavar suz"] },
    { label: "Severe Headache", keywords: ["headache", "sir dard", "seer dard", "dok dukhi", "matha dard"] },
    { label: "Blurring of Vision", keywords: ["blurred vision", "blurring", "dhundhla", "dhisat", "chhakkar", "dizziness"] },
    { label: "Vaginal Bleeding", keywords: ["bleeding", "blood", "rakta", "khoon", "lal paani", "bleeding ahe"] },
    { label: "Decreased Fetal Movement", keywords: ["less movement", "no movement", "halchal kami", "halchal kam", "baby not moving"] },
    { label: "High Fever", keywords: ["fever", "bukhar", "taap", "ang garam"] },
    { label: "Abdominal Pain", keywords: ["abdominal pain", "pet dard", "potat dukhne", "cramps"] },
    { label: "Vomiting", keywords: ["vomit", " ulti", " ulat"] },
  ];

  // "blood pressure" must not trigger the "blood" (bleeding) keyword.
  const symText = ` ${norm.replace(/blood\s*pressure/g, " bp ").replace(/rakta chaap/g, " bp ")} `;
  const hasLatin = (k: string) => {
    let from = 0;
    for (;;) {
      const at = symText.indexOf(k, from);
      if (at < 0) return false;
      // "no swelling" / "without bleeding" are negations, not findings (keywords that already
      // contain their own "no"/"not" are unaffected because they are matched as a whole).
      if (!/(?:^|\s)(?:no|without|denies)\s+$/.test(symText.slice(0, at)) || /^(?:no|not)\b/.test(k)) return true;
      from = at + k.length;
    }
  };
  for (const item of symptomPatterns) {
    if (item.keywords.some(hasLatin)) symptoms.push(item.label);
  }
  for (const label of detectDevanagariSymptoms(symText)) {
    if (!symptoms.includes(label)) symptoms.push(label);
  }

  return {
    bpSys,
    bpDia,
    weight,
    hb,
    fhr,
    fundalHeight,
    symptoms,
    rawTranscript: rawText,
  };
}

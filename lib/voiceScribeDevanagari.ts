/**
 * Devanagari (Hindi / Marathi) support for the voice-to-vitals parser.
 *
 * Gnani Prisma returns NATIVE SCRIPT, so before the (romanised) rules in voiceScribe.ts run
 * we rewrite the transcript into a canonical Latin/digit form:
 *   fold()            Unicode clean-up (nukta, chandrabindu/anusvara, ZWJ, long/short vowels, digits)
 *   canonicalKeywords() "बीपी" -> "bp", "हीमोग्लोबिन" -> "hb", "बाळाचे ठोके" -> "fhr", ...
 *   convertNumberWords() "एकशे तीस" -> "130", "नौ दशमलव पाँच" -> "9.5", "साढ़े नौ" -> "9.5"
 * Symptom keywords stay in Devanagari and are matched against the folded text.
 * Pure, client-safe, no dependencies.
 */

/* ---------------------------------------------------------------- folding */

const DEVA = "\\u0900-\\u097F";

/**
 * Fold a string so that spelling variants compare equal. Applied to BOTH the transcript and every
 * dictionary word, so the dictionaries can be written in natural spelling.
 * Lossy on purpose (never shown to the user): nukta dropped, ँ/ं dropped, ी->ि, ू->ु, ई->इ, ऊ->उ.
 */
export function fold(input: string): string {
  return input
    .normalize("NFC") // precomposed क़ख़ग़ज़ड़ढ़फ़य़ stay decomposed (base + nukta)
    .replace(/[​-‍⁠﻿]/g, "") // ZW(N)J, ZWSP, word joiner, BOM
    .replace(/़/g, "") // nukta
    .replace(/[ँं]/g, "") // chandrabindu, anusvara
    .replace(/ी/g, "ि") // ी -> ि
    .replace(/ू/g, "ु") // ू -> ु
    .replace(/ई/g, "इ") // ई -> इ
    .replace(/ऊ/g, "उ") // ऊ -> उ
    .replace(/ॉ/g, "ो") // ॉ -> ो
    .replace(/ऑ/g, "ओ") // ऑ -> ओ
    .replace(/ऱ/g, "र") // ऱ -> र
    .replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/।|॥/g, " ") // danda
    .toLowerCase();
}

const f = fold;

/* ------------------------------------------------------- number lexicon */

/** value -> spellings (natural spelling; folded at load). */
const HINDI: Record<number, string[]> = {
  0: ["शून्य", "जीरो"],
  1: ["एक"], 2: ["दो"], 3: ["तीन"], 4: ["चार"], 5: ["पांच", "पाँच", "पाच"], 6: ["छह", "छः", "छे", "छै", "छ"], 7: ["सात"], 8: ["आठ"], 9: ["नौ"], 10: ["दस"],
  11: ["ग्यारह", "ग्यारा"], 12: ["बारह", "बारा"], 13: ["तेरह"], 14: ["चौदह"], 15: ["पंद्रह", "पन्द्रह", "पंद्रा"], 16: ["सोलह"], 17: ["सत्रह", "सतरह"], 18: ["अठारह", "अट्ठारह"], 19: ["उन्नीस", "उन्नीस"], 20: ["बीस"],
  21: ["इक्कीस", "इकीस"], 22: ["बाईस", "बाइस"], 23: ["तेईस", "तेइस"], 24: ["चौबीस"], 25: ["पच्चीस", "पचीस"], 26: ["छब्बीस", "छबीस"], 27: ["सत्ताईस", "सत्ताइस", "सताईस"], 28: ["अट्ठाईस", "अठ्ठाईस", "अठाईस", "अट्ठाइस"], 29: ["उनतीस", "उन्तीस"], 30: ["तीस"],
  31: ["इकतीस", "इकत्तीस"], 32: ["बत्तीस"], 33: ["तैंतीस", "तेंतीस", "तैतीस"], 34: ["चौंतीस", "चौतीस"], 35: ["पैंतीस", "पैतीस"], 36: ["छत्तीस"], 37: ["सैंतीस", "सैतीस"], 38: ["अड़तीस", "अडतीस"], 39: ["उनतालीस", "उन्तालीस", "उनचालीस"], 40: ["चालीस"],
  41: ["इकतालीस", "इकतालिस"], 42: ["बयालीस"], 43: ["तैंतालीस", "तैतालीस", "तिरतालीस"], 44: ["चौवालीस", "चौंतालीस", "चवालीस"], 45: ["पैंतालीस", "पैतालीस"], 46: ["छियालीस", "छयालीस"], 47: ["सैंतालीस", "सैतालीस"], 48: ["अड़तालीस", "अडतालीस"], 49: ["उनचास", "उनंचास"], 50: ["पचास"],
  51: ["इक्यावन", "इक्यावन"], 52: ["बावन"], 53: ["तिरपन", "तिरेपन", "तिरपन"], 54: ["चौवन", "चौअन", "चउवन"], 55: ["पचपन"], 56: ["छप्पन"], 57: ["सत्तावन", "सतावन"], 58: ["अट्ठावन", "अठावन", "अठ्ठावन"], 59: ["उनसठ", "उन्सठ"], 60: ["साठ"],
  61: ["इकसठ"], 62: ["बासठ"], 63: ["तिरसठ", "तिरेसठ"], 64: ["चौंसठ", "चौसठ"], 65: ["पैंसठ", "पैसठ"], 66: ["छियासठ", "छासठ"], 67: ["सड़सठ", "सडसठ"], 68: ["अड़सठ", "अडसठ"], 69: ["उनहत्तर", "उनहतर"], 70: ["सत्तर"],
  71: ["इकहत्तर"], 72: ["बहत्तर"], 73: ["तिहत्तर"], 74: ["चौहत्तर"], 75: ["पचहत्तर"], 76: ["छिहत्तर"], 77: ["सतहत्तर", "सतत्तर"], 78: ["अठहत्तर"], 79: ["उन्यासी", "उनासी", "उन्नासी"], 80: ["अस्सी"],
  81: ["इक्यासी"], 82: ["बयासी"], 83: ["तिरासी"], 84: ["चौरासी"], 85: ["पचासी"], 86: ["छियासी"], 87: ["सत्तासी"], 88: ["अट्ठासी", "अठासी"], 89: ["नवासी"], 90: ["नब्बे", "नव्वे"],
  91: ["इक्यानवे", "इक्यानबे"], 92: ["बानवे", "बानबे"], 93: ["तिरानवे", "तिरानबे"], 94: ["चौरानवे", "चौरानबे"], 95: ["पंचानवे", "पंचानबे"], 96: ["छियानवे", "छियानबे"], 97: ["सत्तानवे", "सत्तानबे"], 98: ["अट्ठानवे", "अठानवे"], 99: ["निन्यानवे", "निन्यानबे"],
};

const MARATHI: Record<number, string[]> = {
  0: ["शून्य"],
  1: ["एक"], 2: ["दोन"], 3: ["तीन"], 4: ["चार"], 5: ["पाच", "पांच"], 6: ["सहा"], 7: ["सात"], 8: ["आठ"], 9: ["नऊ", "नउ"], 10: ["दहा"],
  11: ["अकरा"], 12: ["बारा"], 13: ["तेरा"], 14: ["चौदा"], 15: ["पंधरा"], 16: ["सोळा"], 17: ["सतरा"], 18: ["अठरा"], 19: ["एकोणीस", "एकोणिस"], 20: ["वीस"],
  21: ["एकवीस"], 22: ["बावीस"], 23: ["तेवीस"], 24: ["चोवीस"], 25: ["पंचवीस"], 26: ["सव्वीस", "सव्वीस"], 27: ["सत्तावीस"], 28: ["अठ्ठावीस", "अठावीस", "अट्ठावीस"], 29: ["एकोणतीस"], 30: ["तीस"],
  31: ["एकतीस"], 32: ["बत्तीस"], 33: ["तेहतीस", "तेहेतीस", "तेहत्तीस"], 34: ["चौतीस", "चौंतीस"], 35: ["पस्तीस"], 36: ["छत्तीस"], 37: ["सदतीस"], 38: ["अडतीस"], 39: ["एकोणचाळीस"], 40: ["चाळीस"],
  41: ["एक्केचाळीस", "एकेचाळीस"], 42: ["बेचाळीस"], 43: ["त्रेचाळीस", "तेचाळीस"], 44: ["चौर्‍याचाळीस", "चौऱ्याचाळीस", "चव्वेचाळीस", "चौर्याचाळीस"], 45: ["पंचेचाळीस"], 46: ["सेहेचाळीस", "सहेचाळीस", "शेहेचाळीस"], 47: ["सत्तेचाळीस"], 48: ["अठ्ठेचाळीस", "अठेचाळीस"], 49: ["एकोणपन्नास"], 50: ["पन्नास"],
  51: ["एक्कावन्न", "एकावन्न"], 52: ["बावन्न", "बावन"], 53: ["त्रेपन्न", "तेरपन्न"], 54: ["चोपन्न", "चौपन्न"], 55: ["पंचावन्न"], 56: ["छप्पन्न", "छपन्न"], 57: ["सत्तावन्न"], 58: ["अठ्ठावन्न", "अठावन्न"], 59: ["एकोणसाठ"], 60: ["साठ"],
  61: ["एकसष्ठ", "एकसष्ट"], 62: ["बासष्ठ", "बासष्ट"], 63: ["त्रेसष्ठ", "त्रेसष्ट"], 64: ["चौसष्ठ", "चौसष्ट"], 65: ["पासष्ठ", "पासष्ट"], 66: ["सहासष्ठ", "सहासष्ट"], 67: ["सदुसष्ठ", "सदुसष्ट"], 68: ["अडुसष्ठ", "अडुसष्ट"], 69: ["एकोणसत्तर"], 70: ["सत्तर"],
  71: ["एक्काहत्तर", "एकाहत्तर"], 72: ["बाहत्तर"], 73: ["त्र्याहत्तर"], 74: ["चौर्‍याहत्तर", "चौऱ्याहत्तर", "चौर्याहत्तर"], 75: ["पंचाहत्तर"], 76: ["शहात्तर", "शाहात्तर"], 77: ["सत्याहत्तर", "सत्त्याहत्तर"], 78: ["अठ्ठ्याहत्तर", "अठ्याहत्तर"], 79: ["एकोणऐंशी"], 80: ["ऐंशी", "एंशी"],
  81: ["एक्याऐंशी", "एक्क्याऐंशी"], 82: ["ब्याऐंशी"], 83: ["त्र्याऐंशी"], 84: ["चौर्‍याऐंशी", "चौऱ्याऐंशी", "चौर्याऐंशी"], 85: ["पंच्याऐंशी"], 86: ["शहाऐंशी"], 87: ["सत्त्याऐंशी", "सत्याऐंशी"], 88: ["अठ्ठ्याऐंशी", "अठ्याऐंशी"], 89: ["एकोणनव्वद", "एकोणनव्वद"], 90: ["नव्वद"],
  91: ["एक्क्याण्णव", "एक्याण्णव"], 92: ["ब्याण्णव"], 93: ["त्र्याण्णव"], 94: ["चौर्‍याण्णव", "चौऱ्याण्णव", "चौर्याण्णव"], 95: ["पंच्याण्णव"], 96: ["शहाण्णव"], 97: ["सत्त्याण्णव", "सत्याण्णव"], 98: ["अठ्ठ्याण्णव", "अठ्याण्णव"], 99: ["नव्व्याण्णव", "नव्याण्णव"],
};

const NUMBER_WORDS = new Map<string, number>();
for (const table of [HINDI, MARATHI]) {
  for (const [val, words] of Object.entries(table)) {
    for (const w of words) NUMBER_WORDS.set(f(w), Number(val));
  }
}

/** "सौ" / "शे" style hundred markers (when separate from the multiplier). */
const HUNDRED_MARKERS = new Set(["सौ", "सो", "शे", "शेकडा"].map(f));
/** Single-token hundreds: "एकशे", "दोनशे", "एकसौ", "शंभर"... */
const HUNDRED_JOINED = new Map<string, number>(
  [
    ["शंभर", 100], ["एकशे", 100], ["दोनशे", 200], ["एकसौ", 100], ["दोसौ", 200],
    ["दीडशे", 150], ["सव्वाशे", 125], ["सवासौ", 125], ["डेढ़सौ", 150],
  ].map(([w, v]) => [f(w as string), v as number]),
);
/** "डेढ़ सौ" (150), "सवा सौ" (125), "दीड" before marker */
const FRACTION_HUNDREDS = new Map<string, number>([[f("डेढ़"), 150], [f("डेढ"), 150], [f("सवा"), 125], [f("दीड"), 150], [f("सव्वा"), 125]]);

const DECIMAL_POINT = ["दशमलव", "पूर्णांक", "पूर्ण अंक", "पॉइंट", "पॉईंट", "पाइंट", "पॉइन्ट", "पोइंट", "प्वाइंट", "पॉईन्ट"].map(f);

/** Convert Devanagari number words in a folded string into digits. */
export function convertNumberWords(foldedText: string): string {
  const tokens = foldedText.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const tail = (i: number): { add: number; next: number } => {
    const v = NUMBER_WORDS.get(tokens[i] ?? "");
    return v !== undefined && v >= 1 ? { add: v, next: i + 1 } : { add: 0, next: i };
  };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const joined = HUNDRED_JOINED.get(t);
    const frac = FRACTION_HUNDREDS.get(t);
    const n = NUMBER_WORDS.get(t);
    if (joined !== undefined) {
      const r = joined === 150 || joined === 125 ? { add: 0, next: i + 1 } : tail(i + 1);
      out.push(String(joined + r.add));
      i = r.next;
    } else if (HUNDRED_MARKERS.has(t)) {
      // bare "सौ" = 100 (e.g. "सौ बटा साठ")
      const r = tail(i + 1);
      out.push(String(100 + r.add));
      i = r.next;
    } else if (frac !== undefined && HUNDRED_MARKERS.has(tokens[i + 1] ?? "")) {
      out.push(String(frac));
      i += 2;
    } else if (n !== undefined && n >= 1 && n <= 9 && HUNDRED_MARKERS.has(tokens[i + 1] ?? "")) {
      const r = tail(i + 2);
      out.push(String(n * 100 + r.add));
      i = r.next;
    } else if (n !== undefined) {
      out.push(String(n));
      i++;
    } else {
      out.push(t);
      i++;
    }
  }
  let s = out.join(" ");
  // "9 दशमलव 5" -> "9.5"
  const point = DECIMAL_POINT.slice().sort((a, b) => b.length - a.length).join("|");
  s = s.replace(new RegExp(`(\\d+)\\s*(?:${point})\\s*(\\d)(?!\\d)`, "g"), "$1.$2");
  // "साढ़े 9" -> "9.5" (Hindi साढ़े, Marathi साडे)
  s = s.replace(new RegExp(`(?:${f("साढ़े")}|${f("साडे")})\\s*(\\d{1,3})(?!\\d)`, "g"), "$1.5");
  return s;
}

/* --------------------------------------------------------- keywords */

interface Canon {
  words: string[];
  to: string;
  /** also require a boundary after the word (for short words). */
  rightBoundary?: boolean;
}

const LEFT = `(?<![${DEVA}])`;
const RIGHT = `(?![${DEVA}])`;

function compile(rules: Canon[]): { re: RegExp; to: string }[] {
  return rules.map((r) => {
    const alts = r.words.map(f).sort((a, b) => b.length - a.length).map(escapeRe).join("|");
    return { re: new RegExp(`${LEFT}(?:${alts})${r.rightBoundary ? RIGHT : ""}`, "g"), to: r.to };
  });
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ORDER MATTERS: FHR before fundal ("एफएचआर" before "एफएच"), long phrases first.
const CANON = compile([
  {
    to: " fhr ",
    words: [
      "दिल की धड़कन", "बच्चे के दिल की धड़कन", "बच्चे की धड़कन", "भ्रूण की धड़कन", "भ्रूण की हृदय गति", "भ्रूण हृदय गति",
      "बाळाच्या हृदयाचे ठोके", "बाळाच्या हृदयाची गती", "बाळाचे ठोके", "बाळाच्या ठोके", "हृदयाचे ठोके", "हृदय गती", "हृदय गति", "हृदयगती",
      "फीटल हार्ट रेट", "फिटल हार्ट रेट", "फीटल हार्ट", "हार्ट रेट", "एफएचआर", "एफ एच आर", "एफ.एच.आर", "धड़कन", "धडकन", "ठोके",
    ],
  },
  {
    to: " fundal height ",
    words: [
      "गर्भाशयाची उंची", "गर्भाशय की ऊंचाई", "गर्भाशय की ऊँचाई", "गर्भाशय की उंचाई", "गर्भाशयाची ऊंची", "फंडल हाइट", "फंडल हाईट", "फन्डल हाइट",
      "फण्डल हाइट", "फंडल हाईट", "फंडल", "फन्डल", "एसएफएच", "एस एफ एच", "एफएच", "एफ एच",
    ],
  },
  { to: " bp ", words: ["ब्लड प्रेशर", "ब्लडप्रेशर", "ब्लड प्रेसर", "रक्तदाब", "रक्तचाप", "रक्त चाप", "रक्त दाब", "बीपी", "बी पी", "बी.पी"] },
  { to: " weight ", words: ["वजन", "वज़न", "वजनाचे", "वेट", "भार"], rightBoundary: true },
  { to: " kg ", words: ["किलोग्राम", "किलो ग्राम", "किग्रा", "किग्रॅ", "किलो", "केजी", "के जी"], rightBoundary: true },
  {
    to: " hb ",
    words: [
      "हीमोग्लोबिन", "हिमोग्लोबिन", "हेमोग्लोबिन", "हीमोग्लोबीन", "हिमोग्लोबीन", "हेमोग्लोबीन", "हीमोग्लोबिन", "एचबी", "एच बी", "एच.बी", "हीमो", "हिमो",
    ],
  },
]);

const BLOOD_WORDS = [f("रक्त"), f("खून"), f("ख़ून")];
const HB_QTY = `(?:\\s+(?:${["की मात्रा", "का स्तर", "की पातळी", "चे प्रमाण", "प्रमाण", "का प्रमाण", "की मात्र"].map(f).join("|")}))?`;
const FILLERS = ["है", "हैं", "हे", "आहे", "आहेत", "का", "की", "के", "चे", "ची", "चा", "च्या", "लगभग", "करीब", "सुमारे", "आसपास", "तक", "अभी", "आता", "आज", "ही", "भी", "इज", "इस"].map(f);

// "130 बटा 80", "130 बाय 80", "130 से 80", "130 ओवर 80", "130 पर 80"
const BP_SEPARATORS = ["बटा", "बाय", "से", "ओवर", "ऊपर", "उपर", "पर", "अपॉन", "by", "over"].map(f);

/**
 * Rewrite a (possibly mixed-script) transcript into the canonical Latin/digit form used by the
 * romanised rules. Latin text passes through (only lower-cased).
 */
export function canonicalizeDevanagari(raw: string): string {
  let s = fold(raw);
  if (!/[ऀ-ॿ]/.test(s)) return s; // nothing Devanagari: leave the legacy path untouched
  s = s.replace(/[,;:!?()"“”‘’|]/g, " ").replace(/\.(?=\s|$)/g, " ");
  for (const { re, to } of CANON) s = s.replace(re, to);
  s = convertNumberWords(s.replace(/\s+/g, " "));
  // "रक्त 9.5" / "रक्त की मात्रा 9" (blood level) -> hb; other रक्त uses (bleeding) stay as words.
  s = s.replace(new RegExp(`${LEFT}(?:${BLOOD_WORDS.join("|")})${HB_QTY}\\s+(?=\\d)`, "g"), " hb ");
  s = s.replace(new RegExp(`(\\d{2,3})\\s+(?:${BP_SEPARATORS.join("|")})\\s+(\\d{2,3})`, "g"), "$1 over $2");
  // drop filler words between a canonical keyword and its number: "fhr है 140" -> "fhr 140"
  const filler = FILLERS.join("|");
  s = s.replace(new RegExp(`\\b(bp|weight|hb|fhr|fundal height)\\s+(?:(?:${filler})\\s+)+(?=\\d)`, "g"), "$1 ");
  // "weight kg 54" -> "weight 54 kg"
  s = s.replace(/\bweight\s+(?:kg|kilo)\s+(?=\d)/g, "weight ");
  return s.replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------- symptoms */

export interface DevanagariSymptom {
  label: string;
  keywords: string[];
  /** false for symptoms whose natural phrasing contains "नहीं" ("बच्चा हिल नहीं रहा"). */
  negatable: boolean;
}

/** Same labels as the legacy symptom list in voiceScribe.ts (+ "Vomiting"). */
export const DEVANAGARI_SYMPTOMS: DevanagariSymptom[] = [
  { label: "Pedal Edema (Swelling)", negatable: true, keywords: ["सूजन", "सूज", "सुजले", "सुजलेले", "शोथ", "पैरों में सूजन", "पाँव में सूजन", "पायावर सूज"] },
  { label: "Severe Headache", negatable: true, keywords: ["सिरदर्द", "सिर दर्द", "सिर में दर्द", "सरदर्द", "सर दर्द", "सर में दर्द", "डोकेदुखी", "डोके दुख", "डोकं दुख", "डोक दुख", "डोकेदुख", "माथा दर्द"] },
  { label: "Blurring of Vision", negatable: true, keywords: ["धुंधला", "धुंधली", "धुंधलापन", "धुंधला दिखना", "धुंधला दिख", "अंधुक", "अंधुक दिसणे", "नजर धुंधली", "चक्कर", "चक्कर आना", "चक्कर येणे", "भोवळ"] },
  {
    label: "Vaginal Bleeding",
    negatable: true,
    keywords: [
      "रक्तस्राव", "रक्तस्त्राव", "ब्लीडिंग", "ब्लिडिंग", "ब्लिडींग", "रक्त आ रहा", "रक्त आना", "रक्त आया", "रक्त जा", "रक्त पड", "रक्त येत", "रक्त येणे",
      "खून आ रहा", "खून आना", "खून आया", "खून जा", "खून पड", "खून येत", "खून येणे",
    ],
  },
  {
    label: "Decreased Fetal Movement",
    negatable: false,
    keywords: [
      "बच्चे की हलचल कम", "बच्चे की हरकत कम", "बच्चा हिल नहीं", "बच्चा नहीं हिल", "हलचल कम", "हलचल नहीं", "हलचल बंद", "कम हलचल", "कम हरकत",
      "बाळाची हालचाल कमी", "बाळाची हालचाल कम", "हालचाल कमी", "हालचाल जाणवत नाही", "हालचाल नाही", "हालचाल थांब", "कमी हालचाल", "बाळ हलत नाही",
    ],
  },
  { label: "High Fever", negatable: true, keywords: ["बुखार", "तेज बुखार", "ज्वर", "ताप", "बुखार"] },
  { label: "Abdominal Pain", negatable: true, keywords: ["पेट दर्द", "पेट में दर्द", "पेटदर्द", "पोटदुखी", "पोट दुख", "पोटात दुख", "पोटात दुखत", "पोटात कळ"] },
  { label: "Vomiting", negatable: true, keywords: ["उल्टी", "उलटी", "उलट्या", "उल्ट्या", "उलटीसारखे"] },
];

const SYMPTOMS_FOLDED = DEVANAGARI_SYMPTOMS.map((s) => ({
  label: s.label,
  negatable: s.negatable,
  res: [...new Set(s.keywords.map(f))].map((k) => new RegExp(`${LEFT}${escapeRe(k)}`, "g")),
}));

const NEGATORS = ["नहीं", "नही", "नाही", "नसल", "नको"].map(f);
const NEG_AFTER = new RegExp(`^(?:\\s+(?:${["बिल्कुल", "भी", "कोई", "है", "हे", "आहे", "सी"].map(f).join("|")}))?\\s+(?:${NEGATORS.join("|")})(?![${DEVA}])`);
const NEG_BEFORE = new RegExp(`(?:^|\\s)(?:${["बिना", "नो"].map(f).join("|")}|no|without|denies)\\s*$`);

/** Labels of Devanagari symptom keywords found in the (folded) text, skipping negated mentions. */
export function detectDevanagariSymptoms(foldedText: string): string[] {
  const found: string[] = [];
  for (const sym of SYMPTOMS_FOLDED) {
    let hit = false;
    for (const re of sym.res) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(foldedText))) {
        let end = m.index + m[0].length;
        while (end < foldedText.length && /[\u0900-\u097F]/.test(foldedText[end])) end++; // rest of the word
        const negated = sym.negatable && (NEG_AFTER.test(foldedText.slice(end)) || NEG_BEFORE.test(foldedText.slice(0, m.index)));
        if (!negated) hit = true;
        if (m[0].length === 0) re.lastIndex++;
      }
      if (hit) break;
    }
    if (hit) found.push(sym.label);
  }
  return found;
}

/* ------------------------------------------------------- keyterms */

/**
 * Terms sent to Prisma as `keyterms` (<= 200, each <= 40 chars) to bias recognition toward
 * antenatal-clinic vocabulary in English, Hindi and Marathi.
 */
export const CLINICAL_KEYTERMS: string[] = (() => {
  const raw = [
    // English / abbreviations
    "BP", "blood pressure", "systolic", "diastolic", "haemoglobin", "hemoglobin", "Hb", "weight", "kg", "FHR", "fetal heart rate", "foetal heart rate",
    "fundal height", "SFH", "mmHg", "g/dL", "bpm", "swelling", "oedema", "headache", "blurred vision", "bleeding", "vomiting", "fever", "abdominal pain",
    "reduced fetal movement", "dizziness", "IFA", "iron folic acid", "calcium", "ANC", "antenatal", "pre-eclampsia", "anaemia", "gestational age", "weeks",
    // Hindi
    "बीपी", "ब्लड प्रेशर", "रक्तचाप", "वजन", "वज़न", "किलो", "किग्रा", "हीमोग्लोबिन", "हिमोग्लोबिन", "एचबी", "धड़कन", "दिल की धड़कन", "बच्चे की धड़कन",
    "एफएचआर", "फंडल हाइट", "गर्भाशय की ऊंचाई", "एफएच", "सिरदर्द", "सिर दर्द", "धुंधला दिखना", "सूजन", "पैरों में सूजन", "रक्तस्राव", "ब्लीडिंग",
    "चक्कर", "उल्टी", "पेट दर्द", "बुखार", "बच्चे की हलचल कम", "दशमलव", "साढ़े", "बटा", "ओवर", "एक सौ तीस", "एक सौ चालीस", "अस्सी", "नब्बे", "सत्तर",
    "साठ", "पचास", "एक सौ बीस", "एक सौ दस", "एक सौ पचास",
    // Marathi
    "रक्तदाब", "वजन", "हिमोग्लोबिन", "बाळाचे ठोके", "ठोके", "हृदय गती", "बाळाच्या हृदयाचे ठोके", "गर्भाशयाची उंची", "डोकेदुखी", "अंधुक दिसणे", "सूज",
    "रक्तस्त्राव", "उलट्या", "पोटदुखी", "ताप", "बाळाची हालचाल कमी", "पूर्णांक", "बाय", "एकशे तीस", "एकशे चाळीस", "एकशे वीस", "एकशे दहा", "ऐंशी", "नव्वद",
    "सत्तर", "पन्नास", "नऊ", "पासष्ठ", "सदतीस", "अठ्ठावन्न",
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const k = t.trim();
    if (!k || k.length > 40 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= 200) break;
  }
  return out;
})();

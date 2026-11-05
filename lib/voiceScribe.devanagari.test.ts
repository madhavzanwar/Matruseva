import { describe, expect, it } from "vitest";
import { parseVoiceToVitals, CLINICAL_KEYTERMS, type ParsedVitals } from "./voiceScribe";
import { fold, convertNumberWords } from "./voiceScribeDevanagari";

type Expect = Partial<Omit<ParsedVitals, "rawTranscript">>;
const EMPTY = { bpSys: null, bpDia: null, weight: null, hb: null, fhr: null, fundalHeight: null, symptoms: [] as string[] };

/** Prisma-style transcripts (native script, ITN digits where it applies). */
const FIXTURES: { name: string; text: string; want: Expect }[] = [
  // ---- Hindi
  { name: "hi: digits, slash BP", text: "बीपी 130/80 वजन 54 किलो हीमोग्लोबिन 9.5", want: { bpSys: 130, bpDia: 80, weight: 54, hb: 9.5 } },
  { name: "hi: बटा separator", text: "ब्लड प्रेशर 140 बटा 90, वजन 58 किलो।", want: { bpSys: 140, bpDia: 90, weight: 58 } },
  { name: "hi: Devanagari digits", text: "बीपी १२०/८० वज़न ६२ एचबी ९.५", want: { bpSys: 120, bpDia: 80, weight: 62, hb: 9.5 } },
  { name: "hi: number words BP", text: "बीपी एक सौ चालीस बटा नब्बे वजन अट्ठावन किलो", want: { bpSys: 140, bpDia: 90, weight: 58 } },
  { name: "hi: sau tees + assi, space only", text: "रक्तचाप एक सौ तीस अस्सी", want: { bpSys: 130, bpDia: 80 } },
  { name: "hi: decimal words", text: "हीमोग्लोबिन नौ दशमलव पाँच ग्राम", want: { hb: 9.5 } },
  { name: "hi: saadhe", text: "हिमोग्लोबिन साढ़े नौ है", want: { hb: 9.5 } },
  { name: "hi: FHR and fundal height", text: "दिल की धड़कन 142 फंडल हाइट 28", want: { fhr: 142, fundalHeight: 28 } },
  { name: "hi: FHR word, filler है", text: "बच्चे की धड़कन एक सौ चालीस है, गर्भाशय की ऊंचाई अट्ठाईस", want: { fhr: 140, fundalHeight: 28 } },
  { name: "hi: से separator", text: "बीपी 110 से 70 वजन 49", want: { bpSys: 110, bpDia: 70, weight: 49 } },
  { name: "hi: ओवर separator", text: "बीपी 150 ओवर 100", want: { bpSys: 150, bpDia: 100 } },
  { name: "hi: symptoms headache blur swelling", text: "सिरदर्द है, धुंधला दिखता है और पैरों में सूजन", want: { symptoms: ["Pedal Edema (Swelling)", "Severe Headache", "Blurring of Vision"] } },
  { name: "hi: bleeding + less movement", text: "रक्तस्राव हो रहा है और बच्चे की हलचल कम है", want: { symptoms: ["Vaginal Bleeding", "Decreased Fetal Movement"] } },
  { name: "hi: vomiting + abdominal pain + fever", text: "उल्टी, पेट दर्द और बुखार", want: { symptoms: ["High Fever", "Abdominal Pain", "Vomiting"] } },
  { name: "hi: negated swelling", text: "बीपी 120/80 सूजन नहीं है", want: { bpSys: 120, bpDia: 80, symptoms: [] } },
  { name: "hi: negation does not leak to the next clause", text: "सूजन है बुखार नहीं है", want: { symptoms: ["Pedal Edema (Swelling)"] } },
  { name: "hi: nukta/ZWJ variants", text: "वज़न 60 किलो ब्लड‍ प्रेशर 130/90", want: { bpSys: 130, bpDia: 90, weight: 60 } },
  { name: "hi: blood level via रक्त", text: "रक्त 10.5 वजन 61 किग्रा", want: { hb: 10.5, weight: 61 } },
  { name: "hi: sau only", text: "बीपी सौ बटा साठ", want: { bpSys: 100, bpDia: 60 } },
  { name: "hi: dedh sau", text: "बीपी डेढ़ सौ बटा सौ", want: { bpSys: 150, bpDia: 100 } },
  // ---- Marathi
  { name: "mr: रक्तदाब बाय", text: "रक्तदाब एकशे तीस बाय ऐंशी, वजन पन्नास किलो", want: { bpSys: 130, bpDia: 80, weight: 50 } },
  { name: "mr: एकशे चाळीस / नव्वद", text: "बीपी एकशे चाळीस बाय नव्वद", want: { bpSys: 140, bpDia: 90 } },
  { name: "mr: पूर्णांक", text: "हिमोग्लोबिन नऊ पूर्णांक पाच", want: { hb: 9.5 } },
  { name: "mr: साडे", text: "हिमोग्लोबिन साडे दहा", want: { hb: 10.5 } },
  { name: "mr: बाळाचे ठोके + उंची", text: "बाळाचे ठोके एकशे चाळीस, गर्भाशयाची उंची अठ्ठावीस", want: { fhr: 140, fundalHeight: 28 } },
  { name: "mr: हृदय गती digits", text: "हृदय गती 150 एसएफएच 30", want: { fhr: 150, fundalHeight: 30 } },
  { name: "mr: weight 5x", text: "वजन अठ्ठावन्न किलो रक्तदाब 120/80", want: { weight: 58, bpSys: 120, bpDia: 80 } },
  { name: "mr: symptoms", text: "डोकेदुखी, अंधुक दिसणे आणि पायावर सूज", want: { symptoms: ["Pedal Edema (Swelling)", "Severe Headache", "Blurring of Vision"] } },
  { name: "mr: उलट्या, पोटदुखी, ताप", text: "उलट्या होत आहेत, पोटदुखी आणि ताप", want: { symptoms: ["High Fever", "Abdominal Pain", "Vomiting"] } },
  { name: "mr: हालचाल कमी", text: "बाळाची हालचाल कमी जाणवते", want: { symptoms: ["Decreased Fetal Movement"] } },
  { name: "mr: negated सूज", text: "सूज नाही, डोकेदुखी आहे", want: { symptoms: ["Severe Headache"] } },
  { name: "mr: 65 / 92", text: "रक्तदाब एकशे दहा बाय पासष्ठ", want: { bpSys: 110, bpDia: 65 } },
  // ---- English / romanised (legacy path)
  { name: "en: standard", text: "BP 145 over 95, weight 62, hemoglobin 8.4, severe headache and blurred vision", want: { bpSys: 145, bpDia: 95, weight: 62, hb: 8.4, symptoms: ["Severe Headache", "Blurring of Vision"] } },
  { name: "en: blood pressure does not mean bleeding", text: "blood pressure 120/80, haemoglobin 11", want: { bpSys: 120, bpDia: 80, hb: 11 } },
  { name: "en: no swelling", text: "BP 118/76 no swelling", want: { bpSys: 118, bpDia: 76, symptoms: [] } },
  { name: "en: multiple is not vomiting", text: "multiple visits, fhr 140", want: { fhr: 140, symptoms: [] } },
  { name: "hinglish: romanised", text: "BP 130 80, vajan 54 kilo, hemoglobin 9.5, pairon mein sujan", want: { bpSys: 130, bpDia: 80, weight: 54, hb: 9.5, symptoms: ["Pedal Edema (Swelling)"] } },
  // ---- code-mixed
  { name: "mix: BP Devanagari digits + English words", text: "BP 130/80 वजन 54 kg hemoglobin 9.5 सिरदर्द", want: { bpSys: 130, bpDia: 80, weight: 54, hb: 9.5, symptoms: ["Severe Headache"] } },
  { name: "mix: Hindi keywords, English fhr", text: "बीपी 125 over 85, fhr 138, fundal height 30", want: { bpSys: 125, bpDia: 85, fhr: 138, fundalHeight: 30 } },
  { name: "mix: Marathi + Latin hb", text: "वजन 61 किलो Hb 10.2 रक्तदाब 130 बाय 85", want: { weight: 61, hb: 10.2, bpSys: 130, bpDia: 85 } },
  { name: "mix: weight first, BP last", text: "वजन पचपन किलो हीमोग्लोबिन दस बीपी 120/80", want: { weight: 55, hb: 10, bpSys: 120, bpDia: 80 } },
  // ---- never invent values
  { name: "out of range BP ignored", text: "बीपी 300/80", want: { bpSys: null, bpDia: null } },
  { name: "out of range Hb ignored", text: "हीमोग्लोबिन 45", want: { hb: null } },
  { name: "out of range FHR ignored", text: "धड़कन 40", want: { fhr: null } },
  { name: "unrelated chatter yields nothing", text: "नमस्ते डॉक्टर साहब आज मौसम अच्छा है", want: {} },
  { name: "empty", text: "", want: {} },
];

describe("parseVoiceToVitals: Devanagari / code-mixed fixtures", () => {
  expect(FIXTURES.length).toBeGreaterThanOrEqual(25);
  for (const fx of FIXTURES) {
    it(fx.name, () => {
      const r = parseVoiceToVitals(fx.text);
      const { symptoms: wantSym, ...scalars } = fx.want;
      expect({ ...r, symptoms: undefined, rawTranscript: undefined }).toMatchObject({ ...EMPTY, ...scalars, symptoms: undefined, rawTranscript: undefined });
      expect([...r.symptoms].sort()).toEqual([...(wantSym ?? [])].sort());
      expect(r.rawTranscript).toBe(fx.text);
    });
  }
});

describe("fold / number words", () => {
  it("normalises nukta, chandrabindu, ZWJ and digits", () => {
    expect(fold("वज़न")).toBe(fold("वजन"));
    expect(fold("पाँच")).toBe(fold("पांच"));
    expect(fold("हीमोग्लोबिन")).toBe(fold("हिमोग्लोबिन"));
    expect(fold("ब्लड‍")).toBe("ब्लड");
    expect(fold("१२३.५")).toBe("123.5");
  });
  it("converts hundreds and tails", () => {
    const c = (s: string) => convertNumberWords(fold(s));
    expect(c("एक सौ तीस")).toBe("130");
    expect(c("एकशे तीस")).toBe("130");
    expect(c("एकसौ पच्चीस")).toBe("125");
    expect(c("सवा सौ")).toBe("125");
    expect(c("दोन शे")).toBe("200");
    expect(c("पन्नास")).toBe("50");
    expect(c("साढ़े नौ")).toBe("9.5");
    expect(c("नऊ पूर्णांक पाच")).toBe("9.5");
  });
});

describe("CLINICAL_KEYTERMS", () => {
  it("respects Prisma limits and has no duplicates", () => {
    expect(CLINICAL_KEYTERMS.length).toBeGreaterThan(50);
    expect(CLINICAL_KEYTERMS.length).toBeLessThanOrEqual(200);
    for (const t of CLINICAL_KEYTERMS) {
      expect(t.length).toBeGreaterThan(0);
      expect(t.length).toBeLessThanOrEqual(40);
    }
    expect(new Set(CLINICAL_KEYTERMS).size).toBe(CLINICAL_KEYTERMS.length);
    expect(CLINICAL_KEYTERMS).toContain("बीपी");
    expect(CLINICAL_KEYTERMS).toContain("रक्तदाब");
  });
});

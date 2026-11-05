import { SupportedLanguage } from "@/lib/whatsapp";

export interface BotProcessResult {
  success: boolean;
  replyText: string;
  actionTaken: "confirmed_visit" | "reschedule_requested" | "info_provided" | "menu_sent" | "fallback" | "danger_sign";
  patientId: string;
  patientName: string;
  outcomeLogged?: string;
  error?: string;
}

export interface BotPromptOptions {
  patientId: string;
  patientName: string;
  careEventName?: string;
  reason: "overdue" | "due_soon" | "at_risk" | "lost";
  lang?: SupportedLanguage;
  clinicName?: string;
}

/** Formats an interactive automated WhatsApp reminder with 1/2/3 quick reply prompts */
export function buildAutomatedReminderMessage(opts: BotPromptOptions): string {
  const lang = opts.lang || "en";
  const clinic = opts.clinicName || "MatruSetu Clinic";
  const item = opts.careEventName || (lang === "mr" ? "नियमित तपासणी" : lang === "hi" ? "नियमित जांच" : "ANC checkup");
  const name = opts.patientName;

  if (lang === "mr") {
    return (
      `🏥 *${clinic} - माता व बाल आरोग्य*\n\n` +
      `नमस्कार *${name}* ताई, आपली *${item}* तपासणीची वेळ जवळ आली आहे. वेळेवर तपासणी माता आणि बाळाच्या निरोगी वाढीसाठी अत्यंत आवश्यक आहे.\n\n` +
      `कृपया खालील पर्यायांपैकी क्रमांक टाईप करून उत्तर द्या:\n` +
      `1️⃣ - मी या आठवड्यात क्लिनिकला भेट देईन (पुष्टी करा)\n` +
      `2️⃣ - मला नवीन तारीख हवी आहे (क्लिनिकमधून कॉल हवा)\n` +
      `3️⃣ - तपासणीची पूर्वतयारी व माहिती हवी आहे\n\n` +
      `_आपण थेट संदेश पाठवूनही संपर्क साधू शकता._`
    );
  }

  if (lang === "hi") {
    return (
      `🏥 *${clinic} - मातृ एवं शिशु स्वास्थ्य*\n\n` +
      `नमस्ते *${name}* जी, आपकी *${item}* की जांच का समय नजदीक है। समय पर जांच आपके और शिशु के सुरक्षित स्वास्थ्य के लिए आवश्यक है।\n\n` +
      `कृपया नीचे दिए गए विकल्पों में से नंबर लिखकर उत्तर दें:\n` +
      `1️⃣ - मैं इस सप्ताह क्लिनिक आऊंगी (पुष्टि करें)\n` +
      `2️⃣ - मुझे नई तारीख चाहिए (क्लिनिक से कॉल प्राप्त करें)\n` +
      `3️⃣ - जांच की तैयारी व जानकारी चाहिए\n\n` +
      `_आप सीधे संदेश लिखकर भी संपर्क कर सकती हैं।_`
    );
  }

  // English (default)
  return (
    `🏥 *${clinic} - Maternal Health Companion*\n\n` +
    `Hello *${name}*, your scheduled *${item}* is due soon. Regular antenatal visits protect you and your baby's healthy development.\n\n` +
    `Please reply with a number:\n` +
    `1️⃣ - I will visit this week (Confirm)\n` +
    `2️⃣ - Request a callback to reschedule\n` +
    `3️⃣ - Get scan instructions & preparation\n\n` +
    `_Or reply in your preferred language._`
  );
}

/**
 * Normalises typed OR transcribed text for matching: NFC, lower-case, drops
 * nukta / zero-width marks, folds candrabindu to anusvara (आऊँगी == आऊंगी),
 * and turns punctuation (incl. danda ।॥) into spaces.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\u093c\u200b-\u200d\ufeff]/g, "")
    .replace(/\u0901/g, "\u0902") // ँ -> ं
    .replace(/\u0a81/g, "\u0a82") // Gujarati ઁ -> ં
    .replace(/[\u0964\u0965.,!?;:"'`()\[\]{}\-_*~|\\/<>=+#@…“”‘’]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spoken menu digits (hi/mr/gu/en + romanised) -> "1" | "2" | "3". */
const SPOKEN_DIGITS: Record<string, "1" | "2" | "3"> = {
  "१": "1", "૧": "1", "एक": "1", "એક": "1", one: "1", ek: "1", ik: "1", first: "1", पहला: "1", पहिला: "1",
  "२": "2", "૨": "2", दो: "2", दोन: "2", બે: "2", two: "2", do: "2", don: "2", be: "2", दूसरा: "2", दुसरा: "2",
  "३": "3", "૩": "3", तीन: "3", ત્રણ: "3", three: "3", teen: "3", tin: "3", tran: "3", तिसरा: "3", तीसरा: "3",
};
const DIGIT_FILLERS = new Set([
  "नंबर", "नम्बर", "नं", "क्रमांक", "विकल्प", "पर्याय", "ऑप्शन", "ऑपशन", "option", "number", "no", "nambar", "number.",
  "નંબર", "નં", "વિકલ્પ", "ऑप्शन", "दबाओ", "दाबा", "चुनें", "निवडा", "है", "आहे", "please", "चाहिए",
]);

function spokenDigit(tokens: string[]): "1" | "2" | "3" | null {
  const rest = tokens.filter((tk) => !DIGIT_FILLERS.has(tk));
  if (rest.length === 1) return SPOKEN_DIGITS[rest[0]] ?? null;
  return null;
}

const hasAny = (t: string, list: readonly string[]) => list.some((w) => t.includes(w));

const CONFIRM_SUBSTR = [
  "confirm", "yes", "haan", "hanji", "visit", "येणार", "येतो", "आएंगे", "आऊंगी", "आऊंगा", "आउंगी", "आउंगा", "आएगी",
  "आएंगी", "येईन", "येते", "होय", "कन्फर्म", "આવીશ", "આવશે", "આવું", "કન્ફર્મ",
];
/** Short words that must match as whole tokens (substring would hit e.g. यहां). */
const CONFIRM_TOKENS = ["हां", "હા", "હાં"];
const RESCHEDULE_SUBSTR = [
  "reschedule", "call", "help", "मदत", "मदद", "कॉल", "तारीख", "बदल", "फोन", "डेट", "બદલ", "તારીખ", "ડેટ", "ફોન", "કોલ", "મદદ",
];
const RESCHEDULE_TOKENS = ["date", "change", "फ़ोन", "कॉल"];
const INFO_SUBSTR = [
  "scan", "test", "info", "prep", "instructions", "सोनोग्राफी", "तपासणी", "जांच", "तयारी", "जानकारी", "माहिती", "માહિતી",
  "જાણકારી", "તૈયારી", "તપાસ", "સ્કેન", "સોનોગ્રાફી",
];

/** Detects user intent from incoming text (typed or transcribed) in EN/HI/MR/GU */
export function detectIntent(text: string): "confirm" | "reschedule" | "info" | "fallback" {
  const norm = normalizeForMatch(text);
  const tokens = norm.split(" ").filter(Boolean);
  const digit = spokenDigit(tokens);
  const t = digit ?? norm;

  const wantsReschedule = t === "2" || hasAny(t, RESCHEDULE_SUBSTR) || tokens.some((w) => RESCHEDULE_TOKENS.includes(w));

  // 1. Confirm intents. The bare substring "हो" (typed legacy) only wins when nothing says reschedule,
  // so "तारीख बदलनी होगी" is not mistaken for a "yes".
  if (
    t === "1" ||
    hasAny(t, CONFIRM_SUBSTR) ||
    tokens.some((w) => CONFIRM_TOKENS.includes(w)) ||
    (!wantsReschedule && t.includes("हो"))
  ) {
    return "confirm";
  }

  // 2. Reschedule intents
  if (wantsReschedule) return "reschedule";

  // 3. Info intents
  if (t === "3" || hasAny(t, INFO_SUBSTR)) return "info";

  return "fallback";
}

/** Auto-detects language from input string */
export function detectLanguage(text: string, fallback: SupportedLanguage = "en"): SupportedLanguage {
  // Check Devanagari Unicode block
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) {
    // Check Marathi specific words/characters: ळ, ताई, येणार, नमस्कार, आहे/आहेत, नाही, मला, होय
    if (/[\u0933]|ताई|येणार|आहे|नमस्कार|करा|तपासणी|नाही|मला|होय|पाहिजे|दोन/.test(text)) {
      return "mr";
    }
    return "hi";
  }
  return fallback;
}

export type ReplyLanguage = SupportedLanguage | "gu";

/** Like detectLanguage but also recognises Gujarati script (used for safety replies). */
export function detectReplyLanguage(text: string, preferred?: SupportedLanguage): ReplyLanguage {
  if (preferred) return preferred;
  if (/[\u0A80-\u0AFF]/.test(text)) return "gu";
  return detectLanguage(text, "en");
}

/**
 * Conservative danger-sign screen for typed or transcribed messages
 * (bleeding, severe headache, blurred vision, reduced baby movement, fits,
 * leaking fluid, severe pain). False positives are acceptable, false negatives
 * are not, so single keywords match (no "severe" qualifier required).
 */
const DANGER_PATTERNS: readonly string[] = [
  // English / Hinglish
  "bleed", "blood", "spotting", "headache", "head ache", "head pain", "blur", "vision", "can't see", "cannot see", "dizz", "faint",
  "movement", "not moving", "stopped moving", "baby kick", "kicking", "fits", "seizure", "convuls", "leak", "water broke",
  "water break", "fluid", "discharge", "pain", "cramp", "swelling", "swollen", "unconscious", "breath",
  "blooding", "khoon", "khun", "sir dard", "sar dard", "dard", "chakkar", "dhundh", "hilna", "halchal", "pani",
  // Hindi
  "रक्तस्राव", "रक्त स्राव", "रक्त", "ब्लीडिंग", "ब्लिडिंग", "ब्लडिंग", "खून", "सिरदर्द", "सिर दर्द", "सर दर्द", "सरदर्द", "सिर में दर्द",
  "धुंधल", "दिखाई नहीं", "नहीं दिख", "हलचल", "हरकत", "हिल नहीं", "हिलना", "लात", "दौरे", "दौरा", "झटके", "मिर्गी", "पानी",
  "पानी निकल", "दर्द", "चक्कर", "बेहोश", "सूजन", "सांस",
  // Marathi
  "रक्तस्त्राव", "रक्तस्राव", "डोकेदुखी", "डोके दुखत", "डोकं दुखत", "अंधुक", "धूसर", "हालचाल", "हालचालं", "फिट्स", "फिट", "झटका", "आकडी",
  "पाणी", "वेदना", "दुखत", "दुखू", "चक्कर", "भोवळ", "सूज", "दम लागत",
  // Gujarati
  "લોહી", "રક્તસ્રાવ", "બ્લીડિંગ", "બ્લિડિંગ", "માથાનો દુખાવો", "માથું દુખ", "માથુ દુખ", "ઝાંખ", "ઝાખ", "દેખાતું નથી", "દેખાતુ નથી",
  "હલનચલન", "હલચલ", "બાળક હલ", "આંચકી", "આંચકા", "પાણી", "દુખાવો", "દુખે", "દર્દ", "ચક્કર", "બેભાન", "સોજો", "શ્વાસ",
];
const DANGER_NORMALIZED = DANGER_PATTERNS.map(normalizeForMatch);

export function detectDangerSign(text: string): boolean {
  const norm = normalizeForMatch(text);
  if (norm.split(" ").includes("fit")) return true; // whole word only ("fit" inside other words is harmless but noisy)
  return DANGER_NORMALIZED.some((p) => norm.includes(p));
}

export function buildDangerReply(lang: ReplyLanguage, name: string): string {
  if (lang === "mr") {
    return (
      `🚨 *तातडीची सूचना, ${name} ताई:* आपण सांगितलेले लक्षण धोक्याचे असू शकते. कृपया घाबरू नका, पण वाट न पाहता *आत्ताच जवळच्या रुग्णालयात जा* किंवा *108* वर कॉल करा. ` +
      `सोबत कुटुंबातील कोणालातरी घ्या. आमची क्लिनिक टीम आपल्याशी संपर्क साधेल.`
    );
  }
  if (lang === "hi") {
    return (
      `🚨 *जरूरी सूचना, ${name} जी:* आपने जो लक्षण बताया वह खतरे का संकेत हो सकता है। कृपया घबराएं नहीं, लेकिन बिना देर किए *अभी नजदीकी अस्पताल जाएं* या *108* पर कॉल करें। ` +
      `परिवार के किसी सदस्य को साथ ले जाएं। हमारी क्लिनिक टीम आपसे संपर्क करेगी।`
    );
  }
  if (lang === "gu") {
    return (
      `🚨 *તાત્કાલિક સૂચના, ${name} બહેન:* તમે જણાવેલું લક્ષણ જોખમનું હોઈ શકે છે. કૃપા કરી ગભરાશો નહીં, પણ રાહ જોયા વગર *હમણાં જ નજીકની હોસ્પિટલ જાઓ* અથવા *108* પર કૉલ કરો. ` +
      `પરિવારના કોઈ સભ્યને સાથે લો. અમારી ક્લિનિક ટીમ તમારો સંપર્ક કરશે.`
    );
  }
  return (
    `🚨 *Urgent, ${name}:* what you describe can be a danger sign. Please stay calm, but do not wait: *go to the nearest hospital now* or *call 108*. ` +
    `Take a family member with you. Our clinic team will contact you.`
  );
}

/**
 * Handles incoming WhatsApp messages from either live webhook or test simulator.
 * Identifies patient, updates contact_log in Supabase, and returns automated reply.
 */
export async function handleIncomingWhatsAppMessage({
  phone,
  patientId,
  messageText,
  preferredLang,
  via = "text",
}: {
  phone?: string;
  patientId?: string;
  messageText: string;
  preferredLang?: SupportedLanguage;
  /** How the message arrived; "voice" = transcribed WhatsApp voice note. */
  via?: "text" | "voice";
}): Promise<BotProcessResult> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();

  // Find patient by ID or by normalized phone
  let patientQuery = admin.from("patients").select("id, name, clinic_id, phone, status");
  if (patientId) {
    patientQuery = patientQuery.eq("id", patientId);
  } else if (phone) {
    const rawDigits = phone.replace(/\D/g, "");
    const last10 = rawDigits.slice(-10);
    patientQuery = patientQuery.ilike("phone", `%${last10}%`);
  } else {
    return {
      success: false,
      replyText: "Error: No patient identified.",
      actionTaken: "fallback",
      patientId: "",
      patientName: "",
      error: "Missing patient identifier",
    };
  }

  const { data: patients, error: patientErr } = await patientQuery.limit(1);
  if (patientErr || !patients || patients.length === 0) {
    return {
      success: false,
      replyText: "Patient record not found in MatruSetu directory.",
      actionTaken: "fallback",
      patientId: "",
      patientName: "",
      error: patientErr?.message || "Patient not found",
    };
  }

  const patient = patients[0];
  const replyLang = detectReplyLanguage(messageText, preferredLang);

  // SAFETY FIRST: danger signs (typed or spoken) get an urgent instruction before any intent handling.
  if (detectDangerSign(messageText)) {
    try {
      await admin.from("contact_log").insert({
        patient_id: patient.id,
        clinic_id: patient.clinic_id,
        channel: "whatsapp",
        outcome: "reached",
        notes: `DANGER SIGN reported by ${via}. Automated WhatsApp Bot: Patient said "${messageText.trim().slice(0, 300)}". Advised to go to the nearest hospital / call 108. Staff follow-up needed.`,
      });
    } catch (logErr) {
      console.error("Danger sign contact_log failed:", logErr instanceof Error ? logErr.message : "unknown");
    }
    return {
      success: true,
      replyText: buildDangerReply(replyLang, patient.name),
      actionTaken: "danger_sign",
      patientId: patient.id,
      patientName: patient.name,
      outcomeLogged: "reached",
    };
  }

  // Gujarati has no full reply catalogue here yet: answer in Hindi (closest shared script family) rather than English.
  const lang: SupportedLanguage = replyLang === "gu" ? "hi" : replyLang;
  const intent = detectIntent(messageText);

  // Get clinic info for context
  const { data: clinic } = await admin.from("clinics").select("name, phone").eq("id", patient.clinic_id).single();
  const clinicName = clinic?.name || "MatruSetu Clinic";

  if (intent === "confirm") {
    // Patient confirmed visit -> update contact_log with will_visit
    await admin.from("contact_log").insert({
      patient_id: patient.id,
      clinic_id: patient.clinic_id,
      channel: "whatsapp",
      outcome: "will_visit",
      notes: `Automated WhatsApp Bot: Patient replied "${messageText.trim()}". Confirmed upcoming visit.`,
    });

    let reply = "";
    if (lang === "mr") {
      reply =
        `✅ *धन्यवाद ${patient.name} ताई!* आपल्या तपासणीची नोंद करण्यात आली आहे.\n\n` +
        `🏥 *क्लिनिक वेळ:* सोमवार ते शनिवार, सकाळी 9:00 ते संध्याकाळी 6:00.\n\n` +
        `⚠️ *महत्त्वाची सूचना:* तीव्र डोकेदुखी, अंधुक दिसणे, रक्तस्राव किंवा बाळाची हालचाल कमी जाणवल्यास वाट पाहू नका — त्वरित क्लिनिक किंवा 24x7 प्रसूती कक्षाला भेट द्या.`;
    } else if (lang === "hi") {
      reply =
        `✅ *धन्यवाद ${patient.name} जी!* आपकी नियमित जांच की पुष्टि दर्ज कर ली गई है।\n\n` +
        `🏥 *क्लिनिक समय:* सोमवार से शनिवार, सुबह 9:00 से शाम 6:00 बजे तक।\n\n` +
        `⚠️ *आवश्यक सूचना:* यदि तेज सिरदर्द, धुंधला दिखना, रक्तस्राव या शिशु की हलचल कम लगे, तो प्रतीक्षा न करें — तुरंत क्लिनिक या 24x7 लेबर रूम में पधारें।`;
    } else {
      reply =
        `✅ *Thank you, ${patient.name}!* Your ANC visit confirmation has been recorded.\n\n` +
        `🏥 *Clinic Hours:* Monday to Saturday, 9:00 AM – 6:00 PM.\n\n` +
        `⚠️ *Danger Signs:* If you experience severe headache, blurring of vision, bleeding, or reduced fetal movements, do not wait — visit our 24x7 emergency labor room immediately.`;
    }

    return {
      success: true,
      replyText: reply,
      actionTaken: "confirmed_visit",
      patientId: patient.id,
      patientName: patient.name,
      outcomeLogged: "will_visit",
    };
  }

  if (intent === "reschedule") {
    // Patient requested callback / reschedule -> update contact_log with reached
    await admin.from("contact_log").insert({
      patient_id: patient.id,
      clinic_id: patient.clinic_id,
      channel: "whatsapp",
      outcome: "reached",
      notes: `Automated WhatsApp Bot: Patient replied "${messageText.trim()}". Requested callback to reschedule.`,
    });

    let reply = "";
    if (lang === "mr") {
      reply =
        `📞 *समजले ${patient.name} ताई.* आमची क्लिनिक सिस्टर आपल्याला सोयीची नवीन तारीख ठरवण्यासाठी लवकरच कॉल करेल.\n\n` +
        `कोणत्याही तातडीच्या प्रसंगी आमच्या 24x7 आपत्कालीन क्रमांकावर किंवा 108 वर संपर्क साधा.`;
    } else if (lang === "hi") {
      reply =
        `📞 *समझ गए ${patient.name} जी।* हमारी क्लिनिक स्टाफ/सिस्टर आपको कॉल करके आपकी सुविधानुसार नई तारीख तय करेंगी।\n\n` +
        `किसी भी आपातकालीन स्थिति में तुरंत हमारी हेल्पलाइन या 108 पर संपर्क करें।`;
    } else {
      reply =
        `📞 *Understood, ${patient.name}.* Our clinic nurse will call you shortly during OPD hours to help reschedule your appointment.\n\n` +
        `For medical emergencies, please reach our 24x7 maternity desk or dial 108.`;
    }

    return {
      success: true,
      replyText: reply,
      actionTaken: "reschedule_requested",
      patientId: patient.id,
      patientName: patient.name,
      outcomeLogged: "reached",
    };
  }

  if (intent === "info") {
    // Look up upcoming care event
    const { data: upcomingEvents } = await admin
      .from("care_events")
      .select("name, due_from, due_to")
      .eq("patient_id", patient.id)
      .is("completed_at", null)
      .is("skipped_reason", null)
      .order("due_from", { ascending: true })
      .limit(1);

    const eventName = upcomingEvents?.[0]?.name || "Upcoming ANC Scan";

    let reply = "";
    if (lang === "mr") {
      reply =
        `📋 *${eventName} - पूर्वतयारी माहिती:*\n\n` +
        `• *सोनोग्राफी स्कॅन:* स्कॅनच्या 1 तास आधी 3-4 ग्लास पाणी प्यावे (मूत्राशय भरलेले असल्यास स्पष्ट तपासणी होते).\n` +
        `• *रक्त तपासणी / OGTT:* ग्लुकोज चाचणीसाठी उपाशीपोटी येण्याची गरज नाही.\n` +
        `• *कागदपत्रे:* आपले मातृसेतु कार्ड, मागील सर्व स्कॅन रिपोर्ट्स व औषध चिठ्ठी सोबत आणा.\n\n` +
        `पुष्टी करण्यासाठी *1* दाबा, किंवा कॉल हवा असल्यास *2* दाबा.`;
    } else if (lang === "hi") {
      reply =
        `📋 *${eventName} - तैयारी निर्देश:*\n\n` +
        `• *सोनोग्राफी जांच:* जांच से 1 घंटा पहले 3-4 गिलास पानी पिएं (मूत्राशय भरा होने से स्पष्ट इमेज मिलती है)।\n` +
        `• *रक्त जांच / OGTT:* ग्लूकोज जांच के लिए भूखे पेट आने की आवश्यकता नहीं है।\n` +
        `• *दस्तावेज:* अपना मातृसेतु कार्ड, पिछली सभी सोनोग्राफी और ब्लड रिपोर्ट्स साथ लाएं।\n\n` +
        `पुष्टि के लिए *1* लिखें, या कॉल सहायता के लिए *2* लिखें।`;
    } else {
      reply =
        `📋 *${eventName} - Preparation Guidelines:*\n\n` +
        `• *Ultrasound Scans:* Drink 3-4 glasses of water 1 hour prior to scan (moderately full bladder helps soundwave penetration).\n` +
        `• *Glucose Test (OGTT/DIPSI):* Fasting is NOT mandatory for single-step DIPSI.\n` +
        `• *Documents:* Please bring your MatruSetu ANC card, previous ultrasound films, and current medication.\n\n` +
        `Reply *1* to confirm visit, or *2* to request callback.`;
    }

    return {
      success: true,
      replyText: reply,
      actionTaken: "info_provided",
      patientId: patient.id,
      patientName: patient.name,
    };
  }

  // Fallback: Send Interactive Menu
  let fallbackReply = "";
  if (lang === "mr") {
    fallbackReply =
      `नमस्कार ${patient.name} ताई, *${clinicName}* स्वयंचलित WhatsApp सहाय्यक!\n\n` +
      `कृपया खालील पर्यायांपैकी एक निवडा:\n` +
      `1️⃣ - भेटीची पुष्टी करण्यासाठी\n` +
      `2️⃣ - नवीन तारीख ठरवण्यासाठी कॉल मागवण्यासाठी\n` +
      `3️⃣ - पुढील तपासणी व स्कॅन पूर्वतयारी माहितीसाठी`;
  } else if (lang === "hi") {
    fallbackReply =
      `नमस्ते ${patient.name} जी, *${clinicName}* स्वचालित WhatsApp सहायक!\n\n` +
      `कृपया निम्न में से एक विकल्प चुनें:\n` +
      `1️⃣ - जांच की पुष्टि करने के लिए\n` +
      `2️⃣ - नई तारीख के लिए क्लिनिक से कॉल पाने हेतु\n` +
      `3️⃣ - अगली जांच व सोनोग्राफी तैयारी की जानकारी हेतु`;
  } else {
    fallbackReply =
      `Hello ${patient.name}, *${clinicName}* automated WhatsApp companion!\n\n` +
      `Please reply with:\n` +
      `1️⃣ - Confirm upcoming visit\n` +
      `2️⃣ - Request a callback to reschedule\n` +
      `3️⃣ - Get scan instructions & preparation tips`;
  }

  return {
    success: true,
    replyText: fallbackReply,
    actionTaken: "menu_sent",
    patientId: patient.id,
    patientName: patient.name,
  };
}

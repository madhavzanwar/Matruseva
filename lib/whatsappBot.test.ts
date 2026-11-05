import { describe, it, expect, vi } from "vitest";
import {
  buildAutomatedReminderMessage,
  detectLanguage,
  detectIntent,
  detectDangerSign,
  detectReplyLanguage,
  handleIncomingWhatsAppMessage,
} from "./whatsappBot";

const inserts: Array<Record<string, unknown>> = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: chain,
        eq: chain,
        ilike: chain,
        is: chain,
        order: chain,
        limit: async () => ({ data: table === "patients" ? [{ id: "p1", name: "Sunita", clinic_id: "c1", phone: "9" }] : [], error: null }),
        single: async () => ({ data: { name: "Clinic", phone: "1" } }),
        insert: async (row: Record<string, unknown>) => {
          inserts.push(row);
          return { error: null };
        },
      });
      return q;
    },
  }),
}));
import {
  FOGSI_MOHFW_SCHEDULE_ITEMS,
  CLINICAL_RISK_THRESHOLDS,
  CLINICAL_SIGN_OFF_METADATA,
} from "./clinicalProtocols";

describe("whatsappBot - Automated Reminder Formatting", () => {
  it("formats English reminder message with 1/2/3 numbered prompts", () => {
    const text = buildAutomatedReminderMessage({
      patientId: "patient-1",
      patientName: "Sunita Mahant",
      careEventName: "Anomaly scan (TIFFA)",
      reason: "due_soon",
      lang: "en",
      clinicName: "MatruSetu Clinic",
    });

    expect(text).toContain("Sunita Mahant");
    expect(text).toContain("Anomaly scan (TIFFA)");
    expect(text).toContain("1️⃣ - I will visit this week");
    expect(text).toContain("2️⃣ - Request a callback to reschedule");
    expect(text).toContain("3️⃣ - Get scan instructions & preparation");
  });

  it("formats Hindi reminder message with Devanagari numerals and honorific", () => {
    const text = buildAutomatedReminderMessage({
      patientId: "patient-2",
      patientName: "सुनीता",
      careEventName: "सोनोग्राफी",
      reason: "overdue",
      lang: "hi",
      clinicName: "मातृसेतु क्लिनिक",
    });

    expect(text).toContain("सुनीता");
    expect(text).toContain("नमस्ते");
    expect(text).toContain("1️⃣ - मैं इस सप्ताह क्लिनिक आऊंगी");
    expect(text).toContain("2️⃣ - मुझे नई तारीख चाहिए");
    expect(text).toContain("3️⃣ - जांच की तैयारी व जानकारी चाहिए");
  });

  it("formats Marathi reminder message with culturally respectful Tai honorific", () => {
    const text = buildAutomatedReminderMessage({
      patientId: "patient-3",
      patientName: "अनिता",
      careEventName: "अनामली स्कॅन",
      reason: "due_soon",
      lang: "mr",
      clinicName: "मातृसेतु दवाखाना",
    });

    expect(text).toContain("अनिता");
    expect(text).toContain("नमस्कार");
    expect(text).toContain("ताई");
    expect(text).toContain("1️⃣ - मी या आठवड्यात क्लिनिकला भेट देईन");
    expect(text).toContain("2️⃣ - मला नवीन तारीख हवी आहे");
    expect(text).toContain("3️⃣ - तपासणीची पूर्वतयारी व माहिती हवी आहे");
  });
});

describe("whatsappBot - Language Detection", () => {
  it("detects Marathi from Marathi-specific vocabulary", () => {
    expect(detectLanguage("होय मी नक्की येणार आहे")).toBe("mr");
    expect(detectLanguage("ताई मला मदत हवी आहे")).toBe("mr");
    expect(detectLanguage("तपासणीसाठी वेळ हवी")).toBe("mr");
  });

  it("detects Hindi from Hindi Devanagari text", () => {
    expect(detectLanguage("नमस्ते जी मैं कल आऊंगी")).toBe("hi");
    expect(detectLanguage("मुझे नई तारीख चाहिए")).toBe("hi");
  });

  it("falls back to English for Roman script", () => {
    expect(detectLanguage("1 - yes I will come")).toBe("en");
    expect(detectLanguage("Please call me back")).toBe("en");
  });
});

describe("clinicalProtocols - FOGSI & MoHFW Accreditation", () => {
  it("contains all 12 certified standard milestones", () => {
    expect(FOGSI_MOHFW_SCHEDULE_ITEMS).toHaveLength(12);
  });

  it("enforces strict FOGSI CRL / NT scan window (11 to 13.85 weeks)", () => {
    const ntScan = FOGSI_MOHFW_SCHEDULE_ITEMS.find((it) => it.code === "nt_scan");
    expect(ntScan).toBeDefined();
    expect(ntScan?.windowStartWeek).toBe(11);
    expect(ntScan?.windowEndWeek).toBeCloseTo(13.85, 2);
    expect(ntScan?.isCritical).toBe(true);
    expect(ntScan?.clinicalRationale).toContain("45-84 mm");
  });

  it("enforces DIPSI single-step OGTT screening window (24 to 28 weeks)", () => {
    const ogtt = FOGSI_MOHFW_SCHEDULE_ITEMS.find((it) => it.code === "ogtt");
    expect(ogtt).toBeDefined();
    expect(ogtt?.windowStartWeek).toBe(24);
    expect(ogtt?.windowEndWeek).toBe(28);
    expect(ogtt?.isCritical).toBe(true);
  });

  it("specifies certified clinical risk thresholds: 7d at-risk, 21d lost", () => {
    expect(CLINICAL_RISK_THRESHOLDS.atRiskDays).toBe(7);
    expect(CLINICAL_RISK_THRESHOLDS.lostDays).toBe(21);
    expect(CLINICAL_SIGN_OFF_METADATA.signedOff).toBe(false);
  });
});

describe("handleIncomingWhatsAppMessage - phone matching", () => {
  const mockAdmin = (rows: unknown[]) => {
    const q = { select: () => q, eq: () => q, ilike: vi.fn(() => q), limit: vi.fn(async () => ({ data: rows, error: null })) };
    vi.doMock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => q }) }));
    return q;
  };

  it("does not act when the phone matches more than one patient", async () => {
    vi.resetModules();
    const q = mockAdmin([
      { id: "a", name: "A", clinic_id: "c1", phone: "9876543210", status: "active" },
      { id: "b", name: "B", clinic_id: "c2", phone: "+919876543210", status: "active" },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handleIncomingWhatsAppMessage: handle } = await import("./whatsappBot");
    const res = await handle({ phone: "+91 98765 43210", messageText: "1" });
    expect(res.success).toBe(false);
    expect(res.patientId).toBe("");
    expect(q.ilike).toHaveBeenCalledWith("phone", "%9876543210");
    expect(q.limit).toHaveBeenCalledWith(2);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("9876543210");
    warn.mockRestore();
  });
});

describe("detectIntent - typed behaviour is unchanged", () => {
  it.each([
    ["1", "confirm"], ["१", "confirm"], ["yes", "confirm"], ["haan", "confirm"], ["होय मी येणार", "confirm"], ["आऊंगी", "confirm"],
    ["2", "reschedule"], ["२", "reschedule"], ["call me", "reschedule"], ["मदद चाहिए", "reschedule"], ["कॉल करो", "reschedule"],
    ["3", "info"], ["३", "info"], ["scan instructions", "info"], ["जांच की तैयारी", "info"],
    ["hello", "fallback"], ["", "fallback"],
  ])("%s -> %s", (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });
});

describe("detectIntent - Prisma transcripts (Devanagari / Gujarati)", () => {
  it.each([
    ["हाँ मैं आऊँगी", "confirm"],
    ["हाँ मैं आऊँगी।", "confirm"],
    ["हो येणार आहे", "confirm"],
    ["हो, येणार आहे.", "confirm"],
    ["હા હું આવીશ", "confirm"],
    ["हां", "confirm"],
    ["एक", "confirm"],
    ["एक नंबर", "confirm"],
    ["एक नंबर।", "confirm"],
    ["विकल्प एक", "confirm"],
    ["એક", "confirm"],
    ["one", "confirm"],
    ["ek", "confirm"],
    ["दो", "reschedule"],
    ["दोन", "reschedule"],
    ["બે", "reschedule"],
    ["two.", "reschedule"],
    ["दो नंबर", "reschedule"],
    ["तारीख बदलना है", "reschedule"],
    ["तारीख बदलनी होगी", "reschedule"],
    ["फोन करा", "reschedule"],
    ["मुझे फ़ोन करो", "reschedule"],
    ["ડેટ બદલો", "reschedule"],
    ["કોલ કરો", "reschedule"],
    ["तीन", "info"],
    ["तीन नंबर", "info"],
    ["ત્રણ", "info"],
    ["three", "info"],
    ["जानकारी चाहिए", "info"],
    ["माहिती हवी आहे", "info"],
    ["સ્કેન ની માહિતી", "info"],
    ["यहां क्या है", "fallback"],
    ["चार", "fallback"],
  ])("%s -> %s", (text, intent) => {
    expect(detectIntent(text)).toBe(intent);
  });
});

describe("detectReplyLanguage", () => {
  it("separates Marathi, Hindi, Gujarati and English transcripts", () => {
    expect(detectLanguage("हो येणार आहे")).toBe("mr");
    expect(detectLanguage("हाँ मैं आऊँगी")).toBe("hi");
    expect(detectReplyLanguage("ડેટ બદલો")).toBe("gu");
    expect(detectReplyLanguage("yes")).toBe("en");
    expect(detectReplyLanguage("एक", "mr")).toBe("mr");
  });
});

describe("detectDangerSign (typed and spoken, conservative)", () => {
  it.each([
    "bleeding since morning", "I have severe headache", "my vision is blurred", "baby is not moving", "reduced movement of baby",
    "she had a fit", "seizure", "water is leaking", "severe pain in stomach", "khoon aa raha hai",
    "रक्तस्राव हो रहा है", "ब्लीडिंग हो रही है", "खून आ रहा है", "तेज सिरदर्द है", "सिर में तेज दर्द", "आँखों के सामने धुंधला दिख रहा है",
    "बच्चे की हलचल कम है", "दौरे पड़ रहे हैं", "पानी निकल रहा है", "रक्तस्त्राव होत आहे", "खूप डोकेदुखी आहे", "अंधुक दिसत आहे",
    "बाळाची हालचाल कमी झाली", "फिट्स आल्या", "पाणी जात आहे", "લોહી પડે છે", "માથાનો દુખાવો છે", "ઝાંખું દેખાય છે", "બાળક હલનચલન ઓછું", "આંચકી આવે છે",
    "ख़ून आ रहा है।",
  ])("flags: %s", (text) => {
    expect(detectDangerSign(text)).toBe(true);
  });

  it.each(["1", "हाँ मैं आऊँगी", "हो येणार आहे", "तारीख बदलना है", "yes I will come", "ડેટ બદલો", "तीन", "fitness"])("does not flag: %s", (text) => {
    expect(detectDangerSign(text)).toBe(false);
  });
});

describe("handleIncomingWhatsAppMessage - danger signs", () => {
  it("replies urgently in the detected language and logs a 'reached' DANGER SIGN note (voice)", async () => {
    inserts.length = 0;
    const r = await handleIncomingWhatsAppMessage({ phone: "919999999999", messageText: "रक्तस्राव हो रहा है", via: "voice" });
    expect(r.actionTaken).toBe("danger_sign");
    expect(r.replyText).toContain("108");
    expect(r.replyText).toContain("अस्पताल");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ outcome: "reached", channel: "whatsapp", patient_id: "p1", clinic_id: "c1" });
    expect(String(inserts[0].notes)).toContain("DANGER SIGN reported by voice");
  });

  it("also applies to typed messages, in en / mr / gu", async () => {
    inserts.length = 0;
    const en = await handleIncomingWhatsAppMessage({ phone: "919999999999", messageText: "severe headache" });
    expect(en.replyText).toMatch(/108/);
    expect(String(inserts[0].notes)).toContain("DANGER SIGN reported by text");
    const mr = await handleIncomingWhatsAppMessage({ phone: "919999999999", messageText: "डोकेदुखी आहे" });
    expect(mr.replyText).toContain("रुग्णालयात");
    const gu = await handleIncomingWhatsAppMessage({ phone: "919999999999", messageText: "લોહી પડે છે" });
    expect(gu.replyText).toContain("હોસ્પિટલ");
    expect(inserts).toHaveLength(3);
  });

  it("ordinary replies are unaffected and Gujarati intents get a Hindi reply", async () => {
    inserts.length = 0;
    const r = await handleIncomingWhatsAppMessage({ phone: "9999999999", messageText: "ડેટ બદલો", via: "voice" });
    expect(r.actionTaken).toBe("reschedule_requested");
    expect(inserts[0]).toMatchObject({ outcome: "reached" });
    expect(String(inserts[0].notes)).not.toContain("DANGER");
  });
});

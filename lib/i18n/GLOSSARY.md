# MatruSetu glossary (English / Hindi / Marathi)

Use these exact terms everywhere so the same concept never has two names on
screen. If a term you need is missing, add a row here in the same change.

> **Review required.** These translations were drafted without a clinician
> review. A Clinical Lead (Hindi- and Marathi-speaking OB-GYN) must review and
> sign off the glossary and all clinical strings before clinical use.

## Style guide

- **Register:** formal and respectful. Hindi uses "आप" forms (e.g. "दर्ज करें",
  never "दर्ज कर"); Marathi uses "तुम्ही" forms (e.g. "तपासा", "निवडा").
- **Buttons and labels:** short, verb-first imperatives. Sentence case (Devanagari
  has no case; keep English source in sentence case, not Title Case).
- **Natural over literal:** clinic staff in India already say "ANC", "OPD",
  "scan", "BP", "Hb" in Hindi/Marathi speech, so these stay in Latin letters where
  the table says so. Translate the surrounding sentence, not the acronym.
- **Keep as-is (never translate):** brand names (MatruSetu, WhatsApp), units
  (mmHg, g/dL, bpm, kg, cm, mg, IU), lab/test abbreviations (Hb, OGTT, HbA1c,
  TSH, USG), drug names, and numerals. Numbers always use Latin digits (0-9).
- **Dates:** use `formatDate(iso, locale)` from `lib/format.ts`; never hand-build.
- **Placeholders:** keep `{name}`, `{count}` etc. exactly; word order may change.
- **Gender:** the patient is always female; use feminine forms where the
  language requires (Hindi "मरीज़ ... रही है", Marathi "रुग्ण ... आहे").
- **Tone for alerts:** calm and factual, not alarming. Never use colour or icons
  alone; keep the text label.

## Terms

| English | Hindi | Marathi | Note |
|---|---|---|---|
| MatruSetu | MatruSetu | MatruSetu | Brand, untranslated |
| WhatsApp | WhatsApp | WhatsApp | Brand, untranslated |
| ANC (antenatal care) | ANC (प्रसवपूर्व देखभाल) | ANC (प्रसूतीपूर्व काळजी) | Use "ANC" alone in tight UI |
| Antenatal visit | प्रसवपूर्व जाँच | प्रसूतीपूर्व तपासणी | |
| Pregnancy | गर्भावस्था | गर्भावस्था | |
| Pregnant woman / mother | गर्भवती महिला / माँ | गर्भवती महिला / माता | "Mother" in health-card context |
| Patient | मरीज़ | रुग्ण | Use for the person in the register |
| LMP (last menstrual period) | LMP (आख़िरी माहवारी की तारीख़) | LMP (शेवटच्या मासिक पाळीची तारीख) | |
| EDD (expected delivery date) | EDD (प्रसव की अनुमानित तारीख़) | EDD (प्रसूतीची अपेक्षित तारीख) | |
| Gestational age (GA) | गर्भकालीन आयु (GA) | गर्भावधी (GA) | Show as "{weeks} सप्ताह {days} दिन" / "{weeks} आठवडे {days} दिवस" |
| Weeks | सप्ताह | आठवडे | |
| Days | दिन | दिवस | |
| Trimester | तिमाही | तिमाही | |
| First / second / third trimester | पहली / दूसरी / तीसरी तिमाही | पहिली / दुसरी / तिसरी तिमाही | |
| Gravida | गर्भधारण (G) | गर्भधारणा (G) | Write as "G2P1" |
| Para | प्रसव संख्या (P) | प्रसूती संख्या (P) | |
| Gravida/para | G/P | G/P | Keep "G2P1" format |
| Scan / ultrasound | स्कैन (अल्ट्रासाउंड) | स्कॅन (सोनोग्राफी) | "स्कैन" is the everyday word |
| Anomaly scan | विसंगति स्कैन (एनोमली स्कैन) | विसंगती स्कॅन (अ‍ॅनोमली स्कॅन) | Say "एनोमली स्कैन" in brackets for clarity |
| Dating scan | डेटिंग स्कैन | डेटिंग स्कॅन | |
| Growth scan | ग्रोथ स्कैन (विकास जाँच) | ग्रोथ स्कॅन (वाढीची तपासणी) | |
| Haemoglobin (Hb) | हीमोग्लोबिन (Hb) | हिमोग्लोबिन (Hb) | Unit g/dL stays |
| Anaemia | खून की कमी (एनीमिया) | रक्तक्षय (अ‍ॅनिमिया) | |
| Blood pressure (BP) | रक्तचाप (BP) | रक्तदाब (BP) | Unit mmHg stays |
| Hypertension | उच्च रक्तचाप | उच्च रक्तदाब | |
| Pre-eclampsia | प्री-एक्लेम्पसिया | प्री-एक्लेम्पसिया | |
| Weight | वज़न | वजन | |
| Height | कद | उंची | |
| BMI | BMI | BMI | |
| Foetal heart rate (FHR) | भ्रूण की हृदय गति (FHR) | गर्भातील बाळाच्या हृदयाचे ठोके (FHR) | Unit bpm stays |
| Foetal movement | भ्रूण की हलचल | बाळाची हालचाल | |
| Foetus / baby | भ्रूण / शिशु | गर्भ / बाळ | |
| Glucose test (OGTT) | ग्लूकोज़ जाँच (OGTT) | ग्लुकोज चाचणी (OGTT) | |
| Blood test | ख़ून की जाँच | रक्त तपासणी | |
| Urine test | पेशाब की जाँच | लघवी तपासणी | |
| Lab report | लैब रिपोर्ट | लॅब रिपोर्ट | |
| Rh negative | Rh नेगेटिव | Rh निगेटिव्ह | |
| Blood group | ब्लड ग्रुप | रक्तगट | |
| Anti-D injection | एंटी-D इंजेक्शन | अँटी-D इंजेक्शन | |
| Tetanus (Td) injection | टिटनेस (Td) इंजेक्शन | धनुर्वात (Td) इंजेक्शन | |
| Iron and folic acid (IFA) tablets | आयरन-फ़ोलिक एसिड (IFA) की गोलियाँ | आयर्न-फॉलिक अ‍ॅसिड (IFA) गोळ्या | |
| Calcium | कैल्शियम | कॅल्शियम | |
| Vitals | वाइटल्स (BP, वज़न आदि) | व्हायटल्स (BP, वजन इ.) | Short label: "वाइटल्स" / "व्हायटल्स" |
| Visit | विज़िट | भेट | In prose: "जाँच के लिए आना" / "तपासणीसाठी येणे" |
| Next visit | अगली विज़िट | पुढील भेट | |
| Follow-up | फ़ॉलो-अप | पाठपुरावा | Hindi staff use "फ़ॉलो-अप" |
| Overdue | विलंबित | उशीर झालेले | Status badge; prose: "समय पर नहीं आईं" / "वेळेवर आल्या नाहीत" |
| Due | देय | देय | |
| Due today | आज देय | आज देय | |
| Upcoming | आगामी | आगामी | |
| At risk | जोखिम में | जोखमीत | Status badge |
| High risk | उच्च जोखिम | उच्च जोखीम | |
| Lost to follow-up | संपर्क टूट गया | संपर्क तुटला | Status badge; prose: "फ़ॉलो-अप छूट गया" / "पाठपुरावा सुटला" |
| On track | समय पर | नियमित | Status badge |
| Done / completed | पूर्ण | पूर्ण | |
| Missed | छूटा हुआ | चुकलेले | |
| Call queue | कॉल सूची | कॉल यादी | |
| Call | कॉल | कॉल | |
| Contact attempt | संपर्क का प्रयास | संपर्काचा प्रयत्न | |
| Contact log | संपर्क विवरण | संपर्क नोंद | |
| Mark as done | पूर्ण चिह्नित करें | पूर्ण म्हणून नोंदवा | |
| Did not answer | फ़ोन नहीं उठाया | फोन उचलला नाही | |
| OPD register | OPD रजिस्टर | OPD नोंदवही | "OPD" kept in Latin |
| OPD | OPD | OPD | |
| Document | दस्तावेज़ | कागदपत्र | |
| Documents | दस्तावेज़ | कागदपत्रे | |
| OCR (text recognition) | OCR (लिखावट पहचान) | OCR (मजकूर ओळख) | |
| Scan a document (camera) | दस्तावेज़ स्कैन करें | कागदपत्र स्कॅन करा | |
| Assign to patient | मरीज़ से जोड़ें | रुग्णाशी जोडा | |
| Case paper | केस पेपर | केस पेपर | |
| Delivery | प्रसव | प्रसूती | |
| Normal vaginal delivery (NVD) | सामान्य प्रसव (NVD) | सामान्य प्रसूती (NVD) | |
| Caesarean (LSCS) | सीज़ेरियन (LSCS) | सिझेरियन (LSCS) | |
| Birth weight | जन्म के समय वज़न | जन्मावेळचे वजन | |
| Newborn | नवजात शिशु | नवजात बाळ | |
| Miscarriage | गर्भपात (मिसकैरेज) | गर्भपात (मिसकॅरेज) | |
| Close pregnancy | गर्भावस्था बंद करें | गर्भावस्था बंद करा | Ends tracking after delivery/loss |
| Danger signs | ख़तरे के लक्षण | धोक्याची लक्षणे | |
| Alert | चेतावनी | सूचना | |
| Symptoms | लक्षण | लक्षणे | |
| Medicine / prescription | दवा / पर्चा | औषध / प्रिस्क्रिप्शन | |
| Diet / nutrition | आहार / पोषण | आहार / पोषण | |
| Counselling | परामर्श | समुपदेशन | |
| Voice notes | आवाज़ नोट | व्हॉइस नोट | |
| Clinic | क्लिनिक | क्लिनिक | |
| Doctor | डॉक्टर | डॉक्टर | |
| Staff | स्टाफ़ | कर्मचारी | Role label; Hindi staff say "स्टाफ़" |
| Role | भूमिका | भूमिका | |
| Settings | सेटिंग्स | सेटिंग्ज | |
| Thresholds | सीमा-मान | मर्यादा मूल्ये | Alert cut-offs (e.g. BP, Hb) |
| Protocol | प्रोटोकॉल | प्रोटोकॉल | |
| Protocol sign-off | प्रोटोकॉल की स्वीकृति | प्रोटोकॉल मंजुरी | Clinical Lead approves the clinic's protocol |
| Clinical Lead | क्लिनिकल लीड | क्लिनिकल लीड | |
| QR health card | QR हेल्थ कार्ड | QR हेल्थ कार्ड | |
| Scan QR card | QR कार्ड स्कैन करें | QR कार्ड स्कॅन करा | |
| Health card | हेल्थ कार्ड | हेल्थ कार्ड | |
| Timeline | समयरेखा | कालरेषा | |
| Report | रिपोर्ट | अहवाल | |
| One-page report | एक-पृष्ठ रिपोर्ट | एक-पानी अहवाल | |
| Print | प्रिंट करें | प्रिंट करा | |
| Search | खोजें | शोधा | |
| Sign in | साइन इन करें | साइन इन करा | |
| Sign up | साइन अप करें | साइन अप करा | |
| Sign out | साइन आउट करें | साइन आउट करा | |
| Password | पासवर्ड | पासवर्ड | |
| Phone number | फ़ोन नंबर | फोन नंबर | |
| Address | पता | पत्ता | |
| Age | आयु | वय | |
| Language | भाषा | भाषा | |
| Offline | ऑफ़लाइन | ऑफलाइन | |
| Sync | सिंक | सिंक | |
| Primigravida (first pregnancy) | प्राइमिग्रैविडा (पहली गर्भावस्था) | प्रायमिग्रॅव्हिडा (पहिली गर्भावस्था) | Registration questionnaire; option label keeps "Primi" |
| Multigravida | मल्टीग्रैविडा | मल्टिग्रॅव्हिडा | |
| Instrumental delivery (vacuum/forceps) | उपकरण-सहायता से प्रसव | उपकरणांच्या साहाय्याने प्रसूती | |
| Pregnancy loss | गर्भ हानि | गर्भहानी | Miscarriage or stillbirth |
| Stillbirth / IUFD | मृत जन्म / IUFD | मृत जन्म / IUFD | |
| Bad obstetric history (BOH) | खराब प्रसूति इतिहास (BOH) | वाईट प्रसूती इतिहास (BOH) | Recurrent pregnancy loss |
| Preterm delivery | समय से पहले प्रसव | मुदतपूर्व प्रसूती | <37 weeks |
| Gestational diabetes (GDM) | गर्भकालीन मधुमेह (GDM) | गर्भावस्थेतील मधुमेह (GDM) | |
| Postpartum haemorrhage (PPH) | प्रसवोत्तर रक्तस्राव (PPH) | प्रसूतीनंतरचा रक्तस्राव (PPH) | |
| Interpregnancy interval | दो गर्भावस्थाओं के बीच का अंतर | दोन गर्भावस्थांमधील अंतर | |
| Macrosomia (large baby) | बड़ा शिशु (मैक्रोसोमिया) | मोठे बाळ (मॅक्रोसोमिया) | |
| Thalassaemia | थैलेसीमिया | थॅलेसेमिया | |

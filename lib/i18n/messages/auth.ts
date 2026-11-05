import { defineArea } from "../define";

// Area: sign in, sign up, onboarding, auth shell, validation/error messages of auth actions.
// Keys are prefixed "auth." (flat dotted keys). See docs/I18N.md and lib/i18n/GLOSSARY.md.
export const auth = defineArea({
  en: {
    "auth.shell.headline1": "Every pregnancy tracked.",
    "auth.shell.headline2": "Every follow-up caught.",
    "auth.shell.point1": "ANC schedule built automatically from the LMP",
    "auth.shell.point2": "Overdue and at-risk patients surfaced every morning",
    "auth.shell.point3": "Searchable case papers and OPD register",
    "auth.shell.tagline": "Antenatal care and OPD digitisation for OB-GYN clinics.",
    "auth.shell.subtitle": "Maternal & Child Health",

    "auth.field.email": "Email",
    "auth.field.password": "Password",
    "auth.google.continue": "Continue with Google",

    "auth.login.title": "Sign in",
    "auth.login.subtitle": "Welcome back to your clinic",
    "auth.login.submit": "Sign in",
    "auth.login.demoButton": "Demo sign in",
    "auth.login.noAccount": "Don't have an account?",
    "auth.login.signUp": "Sign up",

    "auth.signup.title": "Set up your clinic",
    "auth.signup.subtitle": "Create an account for your OB-GYN practice",
    "auth.signup.passwordHint": "At least 8 characters.",
    "auth.signup.submit": "Create account",
    "auth.signup.or": "or",
    "auth.signup.haveAccount": "Already have an account?",
    "auth.signup.signIn": "Sign in",
    "auth.signup.checkEmail.title": "Check your email",
    "auth.signup.checkEmail.body":
      "We've sent a confirmation link. Click it, then come back and sign in to finish setting up your clinic.",

    "auth.onboarding.title": "Set up your clinic",
    "auth.onboarding.subtitle":
      "This creates your clinic and the default ANC schedule template, which you can edit later in Settings.",
    "auth.onboarding.clinicName": "Clinic name",
    "auth.onboarding.yourName": "Your name",
    "auth.onboarding.submit": "Create clinic",

    "auth.error.email": "Enter a valid email address",
    "auth.error.passwordLength": "Password must be at least 8 characters",
    "auth.error.credentials": "Incorrect email or password.",
    "auth.error.clinicName": "Enter your clinic's name",
    "auth.error.fullName": "Enter your full name",
    "auth.error.sessionExpired": "Your session expired. Please log in again.",
    "auth.error.googleSignIn": "Could not sign in with Google",
  },
  hi: {
    "auth.shell.headline1": "हर गर्भावस्था पर नज़र।",
    "auth.shell.headline2": "हर फ़ॉलो-अप समय पर।",
    "auth.shell.point1": "LMP से ANC शेड्यूल अपने आप तैयार",
    "auth.shell.point2": "हर सुबह विलंबित और जोखिम वाले मरीज़ सामने",
    "auth.shell.point3": "खोजने योग्य केस पेपर और OPD रजिस्टर",
    "auth.shell.tagline": "OB-GYN क्लिनिक के लिए प्रसवपूर्व देखभाल और OPD डिजिटलीकरण।",
    "auth.shell.subtitle": "मातृ एवं शिशु स्वास्थ्य",

    "auth.field.email": "ईमेल",
    "auth.field.password": "पासवर्ड",
    "auth.google.continue": "Google से जारी रखें",

    "auth.login.title": "साइन इन करें",
    "auth.login.subtitle": "अपने क्लिनिक में वापसी पर स्वागत है",
    "auth.login.submit": "साइन इन करें",
    "auth.login.demoButton": "डेमो साइन इन करें",
    "auth.login.noAccount": "खाता नहीं है?",
    "auth.login.signUp": "साइन अप करें",

    "auth.signup.title": "अपना क्लिनिक सेट अप करें",
    "auth.signup.subtitle": "अपने OB-GYN क्लिनिक के लिए खाता बनाएँ",
    "auth.signup.passwordHint": "कम से कम 8 अक्षर।",
    "auth.signup.submit": "खाता बनाएँ",
    "auth.signup.or": "या",
    "auth.signup.haveAccount": "पहले से खाता है?",
    "auth.signup.signIn": "साइन इन करें",
    "auth.signup.checkEmail.title": "अपना ईमेल देखें",
    "auth.signup.checkEmail.body":
      "हमने पुष्टि के लिए एक लिंक भेजा है। उस पर क्लिक करें, फिर वापस आकर साइन इन करें और अपना क्लिनिक सेट अप करना पूरा करें।",

    "auth.onboarding.title": "अपना क्लिनिक सेट अप करें",
    "auth.onboarding.subtitle":
      "इससे आपका क्लिनिक और डिफ़ॉल्ट ANC शेड्यूल टेम्पलेट बन जाएगा, जिसे आप बाद में सेटिंग्स में बदल सकते हैं।",
    "auth.onboarding.clinicName": "क्लिनिक का नाम",
    "auth.onboarding.yourName": "आपका नाम",
    "auth.onboarding.submit": "क्लिनिक बनाएँ",

    "auth.error.email": "सही ईमेल पता दर्ज करें",
    "auth.error.passwordLength": "पासवर्ड कम से कम 8 अक्षर का होना चाहिए",
    "auth.error.credentials": "ईमेल या पासवर्ड ग़लत है।",
    "auth.error.clinicName": "अपने क्लिनिक का नाम दर्ज करें",
    "auth.error.fullName": "अपना पूरा नाम दर्ज करें",
    "auth.error.sessionExpired": "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
    "auth.error.googleSignIn": "Google से साइन इन नहीं हो सका",
  },
  mr: {
    "auth.shell.headline1": "प्रत्येक गर्भावस्थेवर लक्ष.",
    "auth.shell.headline2": "प्रत्येक पाठपुरावा वेळेवर.",
    "auth.shell.point1": "LMP वरून ANC वेळापत्रक आपोआप तयार",
    "auth.shell.point2": "दररोज सकाळी उशीर झालेले आणि जोखमीतील रुग्ण समोर",
    "auth.shell.point3": "शोधता येणारे केस पेपर आणि OPD नोंदवही",
    "auth.shell.tagline": "OB-GYN क्लिनिकसाठी प्रसूतीपूर्व काळजी आणि OPD डिजिटायझेशन.",
    "auth.shell.subtitle": "माता व बाल आरोग्य",

    "auth.field.email": "ईमेल",
    "auth.field.password": "पासवर्ड",
    "auth.google.continue": "Google सह सुरू ठेवा",

    "auth.login.title": "साइन इन करा",
    "auth.login.subtitle": "तुमच्या क्लिनिकमध्ये पुन्हा स्वागत आहे",
    "auth.login.submit": "साइन इन करा",
    "auth.login.demoButton": "डेमो साइन इन करा",
    "auth.login.noAccount": "खाते नाही का?",
    "auth.login.signUp": "साइन अप करा",

    "auth.signup.title": "तुमचे क्लिनिक सेट अप करा",
    "auth.signup.subtitle": "तुमच्या OB-GYN क्लिनिकसाठी खाते तयार करा",
    "auth.signup.passwordHint": "किमान 8 अक्षरे.",
    "auth.signup.submit": "खाते तयार करा",
    "auth.signup.or": "किंवा",
    "auth.signup.haveAccount": "आधीपासून खाते आहे?",
    "auth.signup.signIn": "साइन इन करा",
    "auth.signup.checkEmail.title": "तुमचा ईमेल तपासा",
    "auth.signup.checkEmail.body":
      "आम्ही खात्री करण्यासाठी एक लिंक पाठवली आहे. त्यावर क्लिक करा, मग परत येऊन साइन इन करा आणि क्लिनिक सेट अप पूर्ण करा.",

    "auth.onboarding.title": "तुमचे क्लिनिक सेट अप करा",
    "auth.onboarding.subtitle":
      "यामुळे तुमचे क्लिनिक आणि डिफॉल्ट ANC वेळापत्रक टेम्पलेट तयार होईल, जे तुम्ही नंतर सेटिंग्जमध्ये बदलू शकता.",
    "auth.onboarding.clinicName": "क्लिनिकचे नाव",
    "auth.onboarding.yourName": "तुमचे नाव",
    "auth.onboarding.submit": "क्लिनिक तयार करा",

    "auth.error.email": "योग्य ईमेल पत्ता टाका",
    "auth.error.passwordLength": "पासवर्ड किमान 8 अक्षरांचा असावा",
    "auth.error.credentials": "ईमेल किंवा पासवर्ड चुकीचा आहे.",
    "auth.error.clinicName": "तुमच्या क्लिनिकचे नाव टाका",
    "auth.error.fullName": "तुमचे पूर्ण नाव टाका",
    "auth.error.sessionExpired": "तुमचे सत्र संपले आहे. कृपया पुन्हा साइन इन करा.",
    "auth.error.googleSignIn": "Google ने साइन इन करता आले नाही",
  },
});

/** Keys whose hi/mr value is intentionally identical to English (brand names, units). */
export const untranslated: string[] = [];

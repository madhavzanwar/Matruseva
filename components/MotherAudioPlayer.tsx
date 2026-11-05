"use client";

import { useState, useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/provider";
import Link from "next/link";
import {
  SpeakerHigh,
  Play,
  Pause,
  Heart,
  Baby,
  Pill,
  WarningCircle,
  PhoneCall,
  ArrowLeft,
  Sparkle,
  SkipBack,
  SkipForward,
} from "@phosphor-icons/react";
import { useCounselAudio } from "@/components/useCounselAudio";
import { CounselSeekBar } from "@/components/CounselSeekBar";
import {
  generateCounseling,
  COUNSELING_LANGUAGES,
  type CounselingLanguage,
  type CounselingPatientData,
} from "@/lib/voiceCounselor";

/**
 * Mother-facing chrome. The page is read by the mother (often on the public
 * token link, where there is no staff language), so its labels follow the
 * counselling language she picks, not the staff UI locale. Kept local because
 * the staff catalogue only carries the active staff locale and has no Gujarati.
 */
const CHROME: Record<
  CounselingLanguage,
  {
    week: string;
    defaultClinic: string;
    play: string;
    pause: string;
    speaking: string;
    paused: string;
    idle: string;
    speed: string;
    slow: string;
    normal: string;
    summary: string;
    emergencyLead: string;
    ambulance: string;
    ttsUnsupported: string;
    browserVoice: string;
    connecting: string;
    loadingAudio: string;
    partOf: string;
    prevPart: string;
    nextPart: string;
    seek: string;
    fallbackNotice: string;
  }
> = {
  hi: {
    week: "सप्ताह {n}",
    defaultClinic: "मातृसेतु क्लिनिक",
    play: "आवाज़ में परामर्श सुनें",
    pause: "आवाज़ रोकें",
    speaking: "आवाज़ में संदेश चल रहा है…",
    paused: "रोका गया है",
    idle: "▶️ यहाँ दबाकर आवाज़ में सुनिए",
    speed: "गति:",
    slow: "धीमी (0.8x)",
    normal: "सामान्य (1.0x)",
    summary: "परामर्श विवरण",
    emergencyLead: "कोई भी परेशानी होने पर तुरंत अस्पताल या आशा दीदी से संपर्क करें:",
    ambulance: "आपातकालीन एम्बुलेंस (108) को कॉल करें",
    ttsUnsupported: "इस फ़ोन के ब्राउज़र में आवाज़ सुनाने की सुविधा उपलब्ध नहीं है।",
    browserVoice: "ब्राउज़र की आवाज़",
    connecting: "कनेक्ट हो रहा है…",
    loadingAudio: "आवाज़ लोड हो रही है…",
    partOf: "भाग {n}/{total}",
    prevPart: "पिछला भाग",
    nextPart: "अगला भाग",
    seek: "आवाज़ में आगे-पीछे करें",
    fallbackNotice: "बेहतर आवाज़ अभी उपलब्ध नहीं है, इसलिए फ़ोन की आवाज़ इस्तेमाल हो रही है। सुनने के लिए चलाएँ दबाएँ।",
  },
  mr: {
    week: "आठवडा {n}",
    defaultClinic: "मातृसेतू क्लिनिक",
    play: "आवाजात समुपदेशन ऐका",
    pause: "आवाज थांबवा",
    speaking: "संदेश आवाजात ऐकवला जात आहे…",
    paused: "थांबवले आहे",
    idle: "▶️ आवाजात ऐकण्यासाठी येथे दाबा",
    speed: "गती:",
    slow: "हळू (0.8x)",
    normal: "सामान्य (1.0x)",
    summary: "समुपदेशनाचा तपशील",
    emergencyLead: "कोणताही त्रास झाल्यास त्वरित रुग्णालयात किंवा आशा ताईंशी संपर्क साधा:",
    ambulance: "आपत्कालीन रुग्णवाहिका (108) ला कॉल करा",
    ttsUnsupported: "या फोनच्या ब्राउझरमध्ये आवाज ऐकवण्याची सुविधा उपलब्ध नाही.",
    browserVoice: "ब्राउझरचा आवाज",
    connecting: "कनेक्ट होत आहे…",
    loadingAudio: "आवाज लोड होत आहे…",
    partOf: "भाग {n}/{total}",
    prevPart: "मागील भाग",
    nextPart: "पुढील भाग",
    seek: "आवाजात पुढे-मागे करा",
    fallbackNotice: "उत्तम आवाज सध्या उपलब्ध नाही, म्हणून फोनचा आवाज वापरला जात आहे. ऐकण्यासाठी चालवा दाबा.",
  },
  gu: {
    week: "અઠવાડિયું {n}",
    defaultClinic: "માતૃસેતુ ક્લિનિક",
    play: "અવાજમાં પરામર્શ સાંભળો",
    pause: "અવાજ અટકાવો",
    speaking: "સંદેશ અવાજમાં ચાલી રહ્યો છે…",
    paused: "અટકાવ્યું છે",
    idle: "▶️ અવાજમાં સાંભળવા અહીં દબાવો",
    speed: "ઝડપ:",
    slow: "ધીમી (0.8x)",
    normal: "સામાન્ય (1.0x)",
    summary: "પરામર્શની વિગત",
    emergencyLead: "કોઈપણ તકલીફ થાય તો તરત હોસ્પિટલ અથવા આશા દીદીનો સંપર્ક કરો:",
    ambulance: "ઇમરજન્સી એમ્બ્યુલન્સ (108) ને કૉલ કરો",
    ttsUnsupported: "આ ફોનના બ્રાઉઝરમાં અવાજ સંભળાવવાની સુવિધા ઉપલબ્ધ નથી.",
    browserVoice: "બ્રાઉઝરનો અવાજ",
    connecting: "કનેક્ટ થઈ રહ્યું છે…",
    loadingAudio: "અવાજ લોડ થઈ રહ્યો છે…",
    partOf: "ભાગ {n}/{total}",
    prevPart: "પાછલો ભાગ",
    nextPart: "આગલો ભાગ",
    seek: "અવાજમાં આગળ-પાછળ કરો",
    fallbackNotice: "સારો અવાજ હાલ ઉપલબ્ધ નથી, તેથી ફોનનો અવાજ વાપરવામાં આવ્યો છે. સાંભળવા માટે ચલાવો દબાવો.",
  },
  en: {
    week: "Week {n}",
    defaultClinic: "MatruSetu Clinic",
    play: "Listen to the counselling",
    pause: "Pause audio",
    speaking: "Playing the message…",
    paused: "Paused",
    idle: "▶️ Tap here to listen",
    speed: "Speed:",
    slow: "Slow (0.8x)",
    normal: "Normal (1.0x)",
    summary: "Counselling summary",
    emergencyLead: "If you have any problem, contact the hospital or your ASHA worker right away:",
    ambulance: "Call emergency ambulance (108)",
    ttsUnsupported: "Text-to-speech is not supported in this browser.",
    browserVoice: "Browser voice",
    connecting: "Connecting…",
    loadingAudio: "Loading audio…",
    partOf: "Part {n} of {total}",
    prevPart: "Previous part",
    nextPart: "Next part",
    seek: "Seek in the audio",
    fallbackNotice: "The clear studio voice is unavailable right now, so this phone's voice is used. Tap play to listen.",
  },
};

export interface MotherAudioPlayerProps {
  patientData: CounselingPatientData;
  initialLang?: CounselingLanguage;
  /** Public (token) view for mothers: hides the staff-only "Back" link. */
  publicView?: boolean;
  /**
   * Route that serves the server-built counselling audio (Gnani Timbre): the signed
   * `/listen/<token>/audio` for mothers, `/api/gnani/tts/counsel?patientId=…` for staff.
   * Omitted or unavailable => the browser voice (speechSynthesis) is used as before.
   */
  audioEndpoint?: string;
}

export function MotherAudioPlayer({
  patientData,
  initialLang = "hi",
  publicView = false,
  audioEndpoint,
}: MotherAudioPlayerProps) {
  const t = useT();
  const [lang, setLang] = useState<CounselingLanguage>(initialLang);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speechRate, setSpeechRate] = useState(0.9);
  const [gnaniRate, setGnaniRate] = useState(1.0);

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const counseling = generateCounseling(patientData, lang);
  const ui = CHROME[lang];

  // Server voice. The public link's audio is fixed to the token's language, so after the mother
  // switches language there the browser voice (below, unchanged) takes over.
  const gnani = useCounselAudio({
    endpoint: audioEndpoint ?? null,
    lang,
    rate: gnaniRate,
    enabled: !publicView || lang === initialLang,
  });
  const serverVoice = gnani.engine === "gnani" && !isPlaying; // false while the browser voice is speaking
  const gnaniBusy = serverVoice && (gnani.phase === "playing" || gnani.phase === "loading");
  const showPause = serverVoice ? gnaniBusy : isPlaying && !isPaused;
  const waveActive = serverVoice ? gnani.phase === "playing" : isPlaying && !isPaused;

  const estimatedDuration = Math.max(
    20,
    Math.round(counseling.speechText.split(/\s+/).length / (2.2 * speechRate))
  );

  const stopSpeech = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);
  };

  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  const findVoice = (code: CounselingLanguage): SpeechSynthesisVoice | null => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    const tags: Record<CounselingLanguage, string[]> = {
      hi: ["hi-IN", "hi_IN", "hi"],
      mr: ["mr-IN", "mr_IN", "mr", "hi-IN"],
      gu: ["gu-IN", "gu_IN", "gu", "hi-IN"],
      en: ["en-IN", "en_IN", "en-GB", "en-US", "en"],
    };

    for (const tag of tags[code]) {
      const match = voices.find((v) => v.lang.toLowerCase().replace(/_/g, "-").startsWith(tag.toLowerCase()));
      if (match) return match;
    }
    return voices[0] || null;
  };

  const handlePlayPause = () => {
    if (serverVoice) {
      gnani.toggle(); // called from the tap, so audio.play() is allowed on iOS/Android
      return;
    }
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      alert(ui.ttsUnsupported);
      return;
    }

    if (isPlaying && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      startTimer();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(counseling.speechText);
    utteranceRef.current = utterance;

    const voice = findVoice(lang);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      const defaultLangs: Record<CounselingLanguage, string> = {
        hi: "hi-IN",
        mr: "mr-IN",
        gu: "gu-IN",
        en: "en-IN",
      };
      utterance.lang = defaultLangs[lang];
    }

    utterance.rate = speechRate;
    utterance.pitch = 1.0;

    utterance.onstart = () => {
      setIsPlaying(true);
      setIsPaused(false);
      setCurrentTime(0);
      startTimer();
    };

    utterance.onend = () => {
      stopSpeech();
    };

    utterance.onerror = () => {
      stopSpeech();
    };

    window.speechSynthesis.speak(utterance);
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrentTime((prev) => {
        if (prev >= estimatedDuration) return estimatedDuration;
        return prev + 1;
      });
    }, 1000);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  };

  const progressPercent = Math.min(100, (currentTime / estimatedDuration) * 100);

  return (
    <div lang={lang} className="min-h-screen bg-[var(--color-surface-1)] text-[var(--color-foreground)] py-6 px-4 sm:px-6">
      <div className="mx-auto max-w-lg space-y-5">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between">
          {publicView ? (
            <span />
          ) : (
          <Link
            href={`/patients/${patientData.patientId}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--color-charcoal)] hover:text-[var(--color-primary)]"
          >
            <ArrowLeft size={16} />
            <span>{t("common.back")}</span>
          </Link>
          )}
          <div className="flex items-center gap-1 text-[11px] font-bold text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2.5 py-1 rounded-full">
            <Sparkle size={12} weight="fill" />
            <span>MatruSetu Voice Bridge</span>
          </div>
        </div>

        {/* Big Maternal Greeting Card */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-pc-lilac)_90%,transparent)_0%,var(--color-background)_100%)] p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white shadow-md">
            <SpeakerHigh size={34} weight="fill" />
          </div>

          <h1 className="text-xl font-bold text-[var(--color-foreground)]">
            {patientData.patientName}
          </h1>
          <p className="mt-1 text-xs text-[var(--color-charcoal)] font-medium">
            {ui.week.replace("{n}", String(patientData.gaWeeks ?? 24))} · {patientData.clinicName || ui.defaultClinic}
          </p>

          {/* Language Selector Buttons */}
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {COUNSELING_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  stopSpeech();
                  gnani.stop();
                  setLang(l.code);
                }}
                className={`px-3 py-1.5 text-xs rounded-xl font-bold transition cursor-pointer ${
                  lang === l.code
                    ? "bg-[var(--color-primary)] text-white shadow-xs"
                    : "bg-[var(--color-background)] text-[var(--color-charcoal)] border border-[var(--color-border)] hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {l.nativeLabel}
              </button>
            ))}
          </div>
        </div>

        {/* Prominent Play/Pause Audio Center */}
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] p-6 shadow-md text-center space-y-4">
          <div className="flex justify-center items-center gap-4">
            {serverVoice && gnani.parts > 1 && (
              <button
                type="button"
                onClick={gnani.prev}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-charcoal)] cursor-pointer active:scale-90"
                title={ui.prevPart}
                aria-label={ui.prevPart}
              >
                <SkipBack size={22} weight="fill" />
              </button>
            )}
            <button
              type="button"
              onClick={handlePlayPause}
              className={`flex h-20 w-20 items-center justify-center rounded-full text-white shadow-xl transition-transform active:scale-90 cursor-pointer ${
                showPause
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              }`}
              title={showPause ? ui.pause : ui.play}
              aria-label={showPause ? ui.pause : ui.play}
            >
              {showPause ? (
                <Pause size={36} weight="fill" />
              ) : (
                <Play size={36} weight="fill" className="ml-1" />
              )}
            </button>
            {serverVoice && gnani.parts > 1 && (
              <button
                type="button"
                onClick={gnani.next}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-charcoal)] cursor-pointer active:scale-90"
                title={ui.nextPart}
                aria-label={ui.nextPart}
              >
                <SkipForward size={22} weight="fill" />
              </button>
            )}
          </div>

          <div>
            <h2 className="text-base font-bold text-[var(--color-foreground)]">
              {serverVoice
                ? gnani.phase === "playing"
                  ? ui.speaking
                  : gnani.phase === "loading"
                  ? ui.loadingAudio
                  : gnani.phase === "paused"
                  ? ui.paused
                  : ui.idle
                : isPlaying && !isPaused
                ? ui.speaking
                : isPaused
                ? ui.paused
                : ui.idle}
            </h2>
            <p className="text-xs text-[var(--color-charcoal)] font-mono mt-0.5">
              {serverVoice
                ? ui.partOf.replace("{n}", String(gnani.partIndex + 1)).replace("{total}", String(gnani.parts))
                : `${formatTimer(currentTime)} / ${formatTimer(estimatedDuration)}`}
            </p>
            <p className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-semibold text-[var(--color-charcoal)]">
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5">
                {serverVoice
                  ? "Gnani Timbre"
                  : gnani.engine === "checking"
                  ? ui.connecting
                  : ui.browserVoice}
              </span>
            </p>
            {gnani.fellBack && gnani.engine === "browser" && (
              <p role="status" className="mt-1.5 text-[11px] leading-snug text-amber-800">
                {ui.fallbackNotice}
              </p>
            )}
          </div>

          {/* Soundwave Bars */}
          <div className="flex items-center justify-center gap-1.5 h-8">
            {[40, 70, 50, 90, 60, 85, 45, 95, 75, 50, 80, 65].map((h, i) => (
              <div
                key={i}
                className={`w-1.5 rounded-full bg-emerald-600 transition-all duration-200 ${
                  waveActive ? "animate-pulse" : "opacity-30"
                }`}
                style={{
                  height: waveActive ? `${h}%` : "30%",
                  animationDelay: `${i * 80}ms`,
                }}
              />
            ))}
          </div>

          {/* Progress Bar */}
          {serverVoice && gnani.parts > 0 ? (
            <CounselSeekBar value={gnani.progress} onCommit={gnani.seek} label={ui.seek} />
          ) : (
            <div className="w-full bg-[var(--color-surface-2)] h-2 rounded-full overflow-hidden">
              <div
                className="bg-emerald-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {/* Speed Tuning */}
          <div className="flex items-center justify-center gap-2 pt-1 text-xs text-[var(--color-charcoal)]">
            <span>{ui.speed}</span>
            {[
              { rate: 0.82, audioRate: 0.85, label: ui.slow },
              { rate: 0.95, audioRate: 1.0, label: ui.normal },
            ].map((s) => (
              <button
                key={s.rate}
                type="button"
                onClick={() => {
                  setSpeechRate(s.rate);
                  setGnaniRate(s.audioRate); // applied live to the <audio> element (playbackRate)
                  if (isPlaying) stopSpeech();
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                  speechRate === s.rate
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-[var(--color-surface-2)] text-[var(--color-charcoal)]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Written Advice Cards for Reading */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-charcoal)] px-1">
            {ui.summary}
          </h3>

          {counseling.sections.map((sec, idx) => (
            <div
              key={idx}
              className={`rounded-xl border p-4 shadow-2xs ${
                idx === 3
                  ? "border-red-200 bg-red-50/70 text-red-950"
                  : "border-[var(--color-border)] bg-[var(--color-background)]"
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                {idx === 0 && <Baby size={18} className="text-[var(--color-primary)]" />}
                {idx === 1 && <Pill size={18} className="text-emerald-700" />}
                {idx === 2 && <Heart size={18} className="text-sky-700" />}
                {idx === 3 && <WarningCircle size={18} className="text-red-600" />}
                <h4 className="text-xs font-bold">{sec.title}</h4>
              </div>
              <p className="text-xs leading-relaxed opacity-90 whitespace-pre-line pl-6">
                {sec.content}
              </p>
            </div>
          ))}
        </div>

        {/* Emergency Help Button */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-center space-y-2">
          <p className="text-xs font-semibold text-[var(--color-charcoal)]">
            {ui.emergencyLead}
          </p>
          <a
            href="tel:108"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs px-5 py-2.5 shadow-sm transition"
          >
            <PhoneCall size={16} weight="fill" />
            <span>{ui.ambulance}</span>
          </a>
        </div>
      </div>
    </div>
  );
}

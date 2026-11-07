/**
 * Obstetric Clinical History & Diagnostic Sonography Reports
 * Standardized for Indian Antenatal Care (PMSMA, FOGSI, WHO guidelines).
 */

import { questionnaireToObstetricReport, type RiskFlagCode } from "@/lib/obstetricQuestionnaire";
import type { Translator } from "@/lib/i18n/translate-client";

export interface PastObstetricHistory {
  previousDeliveryMode: "NVD" | "LSCS" | "Assisted (Forceps/Vacuum)" | "None (Primi)";
  pastPreEclampsia: boolean;
  pastGDM: boolean;
  pastPPH: boolean;
  pastMiscarriages: number;
  pastStillbirths: number;
  pastLowBirthWeight: boolean; // Birth weight < 2.5 kg
  lastChildBirthYear?: number | null;
  interPregnancyMonths?: number | null;
  notes: string;
}

export interface FamilyPregnancyHistory {
  familyPreEclampsia: boolean; // Mother or sister
  familyDiabetes: boolean;
  familyTwins: boolean;
  familyGeneticAnomalies: boolean;
  familyHypertension: boolean;
  notes: string;
}

export interface ScanMeasurement {
  label: string;
  value: string;
  unit?: string;
  alert?: boolean;
}

export interface DiagnosticScanReport {
  id: string;
  title: string;
  type: "sonography" | "lab_report" | "prescription";
  date: string;
  gaWeeks?: number;
  findings: string;
  doctorOrLab: string;
  radiologistRegNo?: string;
  isAbnormal?: boolean;
  keyMetrics: ScanMeasurement[];
  svgImage: string; // inline clean medical ultrasound representation
}

/** Realistic inline ultrasound sonogram SVG generator */
export function generateSonogramSvg(title: string, ga: string, efw: string, caliper: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" class="w-full h-full bg-[#0a0d14] rounded-lg">
    <defs>
      <linearGradient id="scanBeam" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#2a3b5c" stop-opacity="0.3" />
        <stop offset="60%" stop-color="#16233b" stop-opacity="0.8" />
        <stop offset="100%" stop-color="#0a0d14" stop-opacity="1" />
      </linearGradient>
      <radialGradient id="fetalGlow" cx="45%" cy="50%" r="40%">
        <stop offset="0%" stop-color="#e2e8f0" stop-opacity="0.75" />
        <stop offset="40%" stop-color="#94a3b8" stop-opacity="0.4" />
        <stop offset="70%" stop-color="#475569" stop-opacity="0.15" />
        <stop offset="100%" stop-color="#0a0d14" stop-opacity="0" />
      </radialGradient>
      <filter id="noiseFilter">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" result="noise" />
        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.12 0" />
        <feComposite in2="SourceGraphic" in="gl" operator="in" />
      </filter>
    </defs>
    
    <!-- Background grid -->
    <path d="M 40 0 L 40 250 M 80 0 L 80 250 M 120 0 L 120 250 M 160 0 L 160 250 M 200 0 L 200 250 M 240 0 L 240 250 M 280 0 L 280 250 M 320 0 L 320 250 M 360 0 L 360 250" stroke="#172033" stroke-width="0.5" stroke-dasharray="2 4" />
    <path d="M 0 30 L 400 30 M 0 60 L 400 60 M 0 90 L 400 90 M 0 120 L 400 120 M 0 150 L 400 150 M 0 180 L 400 180 M 0 210 L 400 210" stroke="#172033" stroke-width="0.5" stroke-dasharray="2 4" />

    <!-- Sector scan cone -->
    <path d="M 200 28 L 50 240 A 240 240 0 0 0 350 240 Z" fill="url(#scanBeam)" />

    <!-- Sonographic acoustic speckle & fetal mass representation -->
    <ellipse cx="185" cy="135" rx="72" ry="54" fill="url(#fetalGlow)" transform="rotate(-12 185 135)" />
    <!-- Fetal cranial vault -->
    <ellipse cx="150" cy="120" rx="32" ry="26" fill="none" stroke="#f1f5f9" stroke-width="2.5" stroke-opacity="0.8" />
    <!-- Midline falx cerebri -->
    <line x1="125" y1="120" x2="175" y2="120" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="3 2" stroke-opacity="0.8" />
    <!-- Spine contour -->
    <path d="M 178 126 Q 225 145 240 185" fill="none" stroke="#f8fafc" stroke-width="3" stroke-linecap="round" stroke-opacity="0.85" stroke-dasharray="4 3" />
    
    <!-- Measurement Calipers (Crosshairs) -->
    <g stroke="#38bdf8" stroke-width="1.5">
      <!-- Caliper 1 -->
      <line x1="124" y1="115" x2="124" y2="125" />
      <line x1="119" y1="120" x2="129" y2="120" />
      <!-- Caliper 2 -->
      <line x1="176" y1="115" x2="176" y2="125" />
      <line x1="171" y1="120" x2="181" y2="120" />
      <!-- Caliper measurement dotted line -->
      <line x1="124" y1="120" x2="176" y2="120" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2 2" />
    </g>

    <!-- Caliper reading overlay -->
    <rect x="132" y="102" width="38" height="14" rx="2" fill="#0284c7" fill-opacity="0.9" />
    <text x="151" y="112" fill="#ffffff" font-size="8" font-family="monospace" text-anchor="middle" font-weight="bold">${caliper}</text>

    <!-- Depth marker scale on right border -->
    <g fill="#94a3b8" font-size="7" font-family="monospace" text-anchor="end">
      <line x1="388" y1="50" x2="394" y2="50" stroke="#64748b" stroke-width="1" />
      <text x="385" y="52">3cm</text>
      <line x1="388" y1="90" x2="394" y2="90" stroke="#64748b" stroke-width="1" />
      <text x="385" y="92">6cm</text>
      <line x1="388" y1="130" x2="394" y2="130" stroke="#64748b" stroke-width="1" />
      <text x="385" y="132">9cm</text>
      <line x1="388" y1="170" x2="394" y2="170" stroke="#64748b" stroke-width="1" />
      <text x="385" y="172">12cm</text>
      <line x1="388" y1="210" x2="394" y2="210" stroke="#64748b" stroke-width="1" />
      <text x="385" y="212">15cm</text>
    </g>

    <!-- Medical Header HUD -->
    <rect x="0" y="0" width="400" height="24" fill="#05070a" fill-opacity="0.95" />
    <text x="12" y="15" fill="#38bdf8" font-size="10" font-family="monospace" font-weight="bold">MATRUSETU SONO-HUB</text>
    <text x="160" y="15" fill="#e2e8f0" font-size="9" font-family="monospace">${title.toUpperCase()}</text>
    <text x="388" y="15" fill="#a7f3d0" font-size="9" font-family="monospace" text-anchor="end">GA: ${ga} · EFW: ${efw}</text>

    <!-- Transducer parameter watermark -->
    <text x="12" y="240" fill="#64748b" font-size="8" font-family="monospace">PROBE: C5-2 (3.5MHz) · MI 0.9 · TIS 0.3 · FPS 28 · GAIN 62dB</text>
  </svg>`;
}

export function generateLabReportSvg(testName: string, param1: string, param2: string, resultStatus: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" class="w-full h-full bg-[#fcfaf7] border border-[#e2d8cb] rounded-lg">
    <!-- Header -->
    <rect x="0" y="0" width="400" height="38" fill="#3e2a5c" />
    <text x="16" y="24" fill="#ffffff" font-size="12" font-family="sans-serif" font-weight="bold">CLINICAL LABORATORY DIAGNOSTIC DOSSIER</text>
    <text x="384" y="24" fill="#e9d5ff" font-size="10" font-family="monospace" text-anchor="end">NABL ACCREDITED</text>

    <!-- Watermark seal -->
    <circle cx="340" cy="140" r="42" fill="none" stroke="#ebd5be" stroke-width="2" stroke-dasharray="4 2" />
    <text x="340" y="136" fill="#c29d78" font-size="8" font-family="sans-serif" text-anchor="middle" font-weight="bold">GOVT RECOGNISED</text>
    <text x="340" y="148" fill="#c29d78" font-size="7" font-family="sans-serif" text-anchor="middle">PMSMA / FRU</text>

    <!-- Lab Test Details -->
    <text x="20" y="62" fill="#584b66" font-size="10" font-family="sans-serif" font-weight="bold">TEST INVESTIGATION:</text>
    <text x="160" y="62" fill="#1c1528" font-size="12" font-family="sans-serif" font-weight="bold">${testName}</text>
    
    <line x1="20" y1="72" x2="380" y2="72" stroke="#ebdcd0" stroke-width="1" />

    <!-- Parameter 1 -->
    <rect x="20" y="85" width="280" height="42" rx="6" fill="#f5ede3" />
    <text x="32" y="103" fill="#6a5d78" font-size="10" font-family="sans-serif">Parameter 1:</text>
    <text x="32" y="118" fill="#1c1528" font-size="12" font-family="sans-serif" font-weight="bold">${param1}</text>

    <!-- Parameter 2 -->
    <rect x="20" y="136" width="280" height="42" rx="6" fill="#f5ede3" />
    <text x="32" y="154" fill="#6a5d78" font-size="10" font-family="sans-serif">Parameter 2:</text>
    <text x="32" y="169" fill="#1c1528" font-size="12" font-family="sans-serif" font-weight="bold">${param2}</text>

    <!-- Pathologist Conclusion Badge -->
    <rect x="20" y="192" width="360" height="36" rx="6" fill="#ede3d5" stroke="#d5c4b1" stroke-width="1" />
    <text x="32" y="214" fill="#3e2a5c" font-size="11" font-family="sans-serif" font-weight="bold">IMPRESSION:</text>
    <text x="120" y="214" fill="#1c1528" font-size="11" font-family="sans-serif">${resultStatus}</text>
  </svg>`;
}

/** Patient-specific obstetric data bank */
export const DEMO_OBSTETRIC_RECORDS: Record<
  string,
  {
    pastHistory: PastObstetricHistory;
    familyHistory: FamilyPregnancyHistory;
    scans: DiagnosticScanReport[];
  }
> = {
  "p1-pooja-deshmukh": {
    pastHistory: {
      previousDeliveryMode: "NVD",
      pastPreEclampsia: false,
      pastGDM: false,
      pastPPH: false,
      pastMiscarriages: 0,
      pastStillbirths: 0,
      pastLowBirthWeight: false,
      lastChildBirthYear: 2023,
      interPregnancyMonths: 28,
      notes: "Previous uncomplicated full-term normal vaginal delivery at 39w 2d (2023). Female infant (3.15 kg). Good immediate cry, uneventful recovery.",
    },
    familyHistory: {
      familyPreEclampsia: true,
      familyDiabetes: false,
      familyTwins: false,
      familyGeneticAnomalies: false,
      familyHypertension: true,
      notes: "Biological mother developed Gestational Hypertension during 3rd pregnancy. No history of eclampsia or cardiovascular stroke in first-degree relatives.",
    },
    scans: [
      {
        id: "scan-p1-1",
        title: "Early Dating & Viability USG",
        type: "sonography",
        date: "2026-06-08",
        gaWeeks: 8.4,
        findings: "Single live intrauterine gestation sac noted. Regular cardiac flicker. CRL corresponds to 8w 3d. Gestational sac well implanted in upper uterine pole. No subchorionic hematoma.",
        doctorOrLab: "Dr. S. Kulkarni, MBBS, DMRD (Radiologist)",
        radiologistRegNo: "MCI-48291/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "CRL", value: "18.6", unit: "mm" },
          { label: "Heart Rate", value: "158", unit: "bpm" },
          { label: "Sac Location", value: "Fundal" },
        ],
        svgImage: generateSonogramSvg("Dating & Viability", "8w 3d", "12g", "CRL 18.6mm"),
      },
      {
        id: "scan-p1-2",
        title: "NT Scan & First Trimester Combined Screen",
        type: "sonography",
        date: "2026-07-06",
        gaWeeks: 12.5,
        findings: "Fetal spine and cranium visible. Nuchal Translucency (NT) is 1.4 mm (< 2.5 mm normal cut-off). Nasal bone clearly ossified. Low calculated risk for Trisomy 21, 18, and 13.",
        doctorOrLab: "SRL Diagnostics, Deccan Gymkhana, Pune",
        radiologistRegNo: "MCI-52110/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "NT", value: "1.4", unit: "mm" },
          { label: "Nasal Bone", value: "Present" },
          { label: "Aneuploidy Risk", value: "Low Risk (1:4800)" },
        ],
        svgImage: generateSonogramSvg("NT + Aneuploidy", "12w 4d", "68g", "NT 1.4mm"),
      },
      {
        id: "scan-p1-3",
        title: "Targeted TIFFA Level-II Anomaly Scan",
        type: "sonography",
        date: "2026-08-22",
        gaWeeks: 19.3,
        findings: "Detailed structural survey shows normal 4-chamber cardiac view and symmetric ventricular outflow tracts. Intact fetal spine and abdominal wall. Placenta is Anterior, Grade I maturity, well clear of internal os. Amniotic Fluid Index (AFI) is 14.5 cm (adequate).",
        doctorOrLab: "Dr. S. Kulkarni, MBBS, DMRD",
        radiologistRegNo: "MCI-48291/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "Placenta", value: "Anterior (Normal)" },
          { label: "AFI", value: "14.5", unit: "cm" },
          { label: "EFW", value: "298", unit: "g" },
          { label: "Fetal Spine", value: "Intact" },
        ],
        svgImage: generateSonogramSvg("Targeted TIFFA", "19w 2d", "298g", "BPD 44mm"),
      },
      {
        id: "lab-p1-4",
        title: "Complete Hemogram & Biochemical Screen",
        type: "lab_report",
        date: "2026-09-02",
        findings: "Mild hypochromic microcytic anemia (Hb 10.4 g/dL). Platelets normal. Blood grouping confirmed B Positive. Urine routine: Albumin Nil, Sugar Nil.",
        doctorOrLab: "Suburban Diagnostics Lab, Pune",
        isAbnormal: true,
        keyMetrics: [
          { label: "Hemoglobin", value: "10.4", unit: "g/dL", alert: true },
          { label: "Blood Group", value: "B Positive" },
          { label: "Urine Protein", value: "Nil" },
          { label: "Platelet Count", value: "2.4", unit: "Lakhs/mcL" },
        ],
        svgImage: generateLabReportSvg("Complete Hemogram & Urine Screen", "Hb: 10.4 g/dL · TLC: 8,400", "Platelets: 2.4L · Urine Albumin: Nil", "Mild Microcytic Anemia. Continue Oral IFA."),
      },
    ],
  },

  "p2-sunita-verma": {
    pastHistory: {
      previousDeliveryMode: "LSCS",
      pastPreEclampsia: false,
      pastGDM: false,
      pastPPH: false,
      pastMiscarriages: 0,
      pastStillbirths: 0,
      pastLowBirthWeight: false,
      lastChildBirthYear: 2022,
      interPregnancyMonths: 38,
      notes: "Previous emergency Lower Segment Cesarean Section (LSCS) for prolonged labor with non-reassuring fetal heart rate. Male baby 3.4 kg. Uneventful wound healing. Previous uterine scar confirmed lower segment transverse.",
    },
    familyHistory: {
      familyPreEclampsia: true,
      familyDiabetes: true,
      familyTwins: false,
      familyGeneticAnomalies: false,
      familyHypertension: true,
      notes: "Biological elder sister had severe Pre-eclampsia at 34 weeks requiring early induction. Mother has Type-2 diabetes managed with oral hypoglycemics.",
    },
    scans: [
      {
        id: "scan-p2-1",
        title: "Dating USG & Previous Scar Assessment",
        type: "sonography",
        date: "2026-04-18",
        gaWeeks: 8.1,
        findings: "Single live IUP. Gestational sac implanted centrally in mid-corpus, well distant from lower uterine cesarean scar site (no cesarean scar ectopic pregnancy). FHR 150 bpm. CRL 17.2 mm.",
        doctorOrLab: "Lifeline Ultrasound & Scan Centre",
        radiologistRegNo: "MCI-39182/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "Sac Site", value: "Fundal/Safe" },
          { label: "CRL", value: "17.2", unit: "mm" },
          { label: "FHR", value: "150", unit: "bpm" },
        ],
        svgImage: generateSonogramSvg("Dating & Scar Site", "8w 1d", "14g", "CRL 17.2mm"),
      },
      {
        id: "scan-p2-2",
        title: "TIFFA Level-II Anomaly & Scar Thickness Scan",
        type: "sonography",
        date: "2026-07-08",
        gaWeeks: 19.5,
        findings: "Normal intracranial and abdominal anatomy. Placenta is Posterior, Grade I, upper segment (no placenta previa or accreta spectrum). Lower uterine segment (LUS) scar thickness measured at 4.1 mm (adequate thickness > 3.0 mm). AFI 13.8 cm.",
        doctorOrLab: "Dr. Arvind Mehta, MD (Radiology)",
        radiologistRegNo: "MCI-31290/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "Scar Thickness", value: "4.1", unit: "mm" },
          { label: "Placenta", value: "Posterior (Safe)" },
          { label: "AFI", value: "13.8", unit: "cm" },
          { label: "EFW", value: "320", unit: "g" },
        ],
        svgImage: generateSonogramSvg("TIFFA + Scar Thickness", "19w 4d", "320g", "LUS 4.1mm"),
      },
      {
        id: "scan-p2-3",
        title: "Targeted Fetal Doppler & Placental Perfusion (26w)",
        type: "sonography",
        date: "2026-08-24",
        gaWeeks: 26.2,
        findings: "Fetal growth on 50th percentile. Umbilical artery Doppler demonstrates normal forward diastolic flow (PI: 0.98, RI: 0.62). Bilateral uterine artery flow waveform demonstrates low resistance with absence of early diastolic notch.",
        doctorOrLab: "Dr. Arvind Mehta, MD (Radiology)",
        radiologistRegNo: "MCI-31290/MH",
        isAbnormal: false,
        keyMetrics: [
          { label: "Umbilical PI", value: "0.98" },
          { label: "Uterine Notch", value: "Absent" },
          { label: "EFW", value: "910", unit: "g" },
          { label: "AFI", value: "12.4", unit: "cm" },
        ],
        svgImage: generateSonogramSvg("Fetal Doppler (26w)", "26w 1d", "910g", "UA PI 0.98"),
      },
      {
        id: "lab-p2-4",
        title: "PMSMA Antenatal Biochemical Profile & OGTT",
        type: "lab_report",
        date: "2026-09-15",
        findings: "Blood Group: O Rh Positive. Moderate Nutritional Anemia (Hb 9.8 g/dL). 75g Oral Glucose Tolerance Test (OGTT): Fasting 88 mg/dL, 2-Hour post-load 124 mg/dL (Normal < 140 mg/dL, GDM ruled out). Urine Albumin: Trace, Urine Sugar: Nil.",
        doctorOrLab: "District Hospital Clinical Pathology Lab",
        isAbnormal: true,
        keyMetrics: [
          { label: "Hemoglobin", value: "9.8", unit: "g/dL", alert: true },
          { label: "OGTT 2-hr", value: "124", unit: "mg/dL" },
          { label: "Blood Pressure", value: "138/88", unit: "mmHg", alert: true },
          { label: "Urine Protein", value: "Trace", alert: true },
        ],
        svgImage: generateLabReportSvg("Antenatal Metabolic & OGTT Panel", "Hb: 9.8 g/dL (Mod Anemia) · OGTT 2h: 124 mg/dL", "BP: 138/88 mmHg · Urine Protein: Trace", "Borderline Gestational HTN Risk. Intensive Anemia Treatment."),
      },
    ],
  },

  "p4-priya-sharma": {
    pastHistory: {
      previousDeliveryMode: "None (Primi)",
      pastPreEclampsia: false,
      pastGDM: false,
      pastPPH: false,
      pastMiscarriages: 1,
      pastStillbirths: 0,
      pastLowBirthWeight: false,
      lastChildBirthYear: null,
      interPregnancyMonths: 18,
      notes: "One spontaneous 1st-trimester miscarriage at 7 weeks (2024). Surgical evacuation done. Received Anti-D immunoglobulin 150 mcg post-procedure.",
    },
    familyHistory: {
      familyPreEclampsia: false,
      familyDiabetes: false,
      familyTwins: true,
      familyGeneticAnomalies: false,
      familyHypertension: false,
      notes: "Maternal grandmother had fraternal twin pregnancy. No family history of bleeding diathesis or recurrent miscarriages.",
    },
    scans: [
      {
        id: "scan-p4-1",
        title: "Viability & Early Dating USG",
        type: "sonography",
        date: "2026-04-12",
        gaWeeks: 7.5,
        findings: "Single live intrauterine pregnancy. Regular cardiac pulsation. Gestational sac well defined, CRL 13.4 mm corresponding to 7w 4d. Normal adnexa.",
        doctorOrLab: "Apex Diagnostic Imaging",
        isAbnormal: false,
        keyMetrics: [
          { label: "CRL", value: "13.4", unit: "mm" },
          { label: "FHR", value: "148", unit: "bpm" },
        ],
        svgImage: generateSonogramSvg("Early Viability", "7w 4d", "10g", "CRL 13.4mm"),
      },
      {
        id: "scan-p4-2",
        title: "TIFFA Anomaly Scan & Placental Mapping",
        type: "sonography",
        date: "2026-07-02",
        gaWeeks: 19.1,
        findings: "Normal anatomical survey. Cranial and spinal integrity intact. Placenta is Fundal-Posterior (no previa). AFI 14.1 cm. EFW 312g.",
        doctorOrLab: "Apex Diagnostic Imaging",
        isAbnormal: false,
        keyMetrics: [
          { label: "Placenta", value: "Fundal-Posterior" },
          { label: "AFI", value: "14.1", unit: "cm" },
          { label: "EFW", value: "312", unit: "g" },
        ],
        svgImage: generateSonogramSvg("TIFFA Survey", "19w 1d", "312g", "AFI 14.1cm"),
      },
      {
        id: "lab-p4-3",
        title: "Anti-D Antibody Titre & Rh Isoimmunization Screen",
        type: "lab_report",
        date: "2026-09-04",
        findings: "Maternal Blood Group: O Rh Negative. Indirect Coombs Test (ICT): Negative (1:1 titer). No evidence of maternal anti-D isoimmunization. Candidate for 28-week routine antenatal Anti-D prophylaxis (300 mcg).",
        doctorOrLab: "City Blood Bank & Transfusion Medicine",
        isAbnormal: false,
        keyMetrics: [
          { label: "Blood Group", value: "O Rh Negative", alert: true },
          { label: "Indirect Coombs (ICT)", value: "Negative (Titer < 1:2)" },
          { label: "Anti-D Status", value: "Unsensitized" },
        ],
        svgImage: generateLabReportSvg("Rh Isoimmunization & ICT Panel", "Blood: O Negative · ICT: Negative (< 1:2)", "Anti-D 300mcg Recommended at 28w", "Unsensitized Rh Negative Mother. Administer Anti-D."),
      },
    ],
  },
};

export interface PatientObstetricDataResult {
  pastHistory: PastObstetricHistory;
  familyHistory: FamilyPregnancyHistory;
  scans: DiagnosticScanReport[];
  /**
   * Stable codes of the risk flags derived from the registration questionnaire
   * (empty for patients without one). Localise with `localizeRiskFlags`.
   */
  questionnaireRiskFlags: RiskFlagCode[];
}

/** A stored registration questionnaire plus the translator its report notes are written with. */
export interface QuestionnaireReportInput {
  /** Untrusted on purpose (it comes from a JSON store): it is normalised before use. */
  answers: unknown;
  t: Translator;
}

/**
 * Returns comprehensive obstetric history and diagnostic scan data for any patient.
 * Generates tailored clinical records for custom patients based on Gravida/Para.
 * When the patient has a registration questionnaire, its answers replace the
 * generated past/family history (scans stay as they are).
 */
export function getPatientObstetricData(
  patientId: string,
  patientName: string,
  gravida = 1,
  para = 0,
  rhNegative = false,
  questionnaire?: QuestionnaireReportInput | null,
): PatientObstetricDataResult {
  const base = DEMO_OBSTETRIC_RECORDS[patientId] ?? generateDefaultObstetricData(patientId, patientName, gravida, para, rhNegative);

  if (questionnaire) {
    const { pastHistory, familyHistory, derivedRiskFlags } = questionnaireToObstetricReport(questionnaire.answers, gravida, para, questionnaire.t);
    return { pastHistory, familyHistory, scans: base.scans, questionnaireRiskFlags: derivedRiskFlags };
  }

  return { ...base, questionnaireRiskFlags: [] };
}

function generateDefaultObstetricData(
  patientId: string,
  patientName: string,
  gravida = 1,
  para = 0,
  rhNegative = false,
): Omit<PatientObstetricDataResult, "questionnaireRiskFlags"> {
  // Derive customized medical history for any dynamically registered patient
  const isPrimi = gravida <= 1 && para === 0;
  const prevDeliveryMode = isPrimi ? "None (Primi)" : para > 0 ? "NVD" : "None (Primi)";

  const pastHistory: PastObstetricHistory = {
    previousDeliveryMode: prevDeliveryMode,
    pastPreEclampsia: false,
    pastGDM: false,
    pastPPH: false,
    pastMiscarriages: Math.max(0, gravida - para - 1),
    pastStillbirths: 0,
    pastLowBirthWeight: false,
    lastChildBirthYear: isPrimi ? null : 2023,
    interPregnancyMonths: isPrimi ? null : 24,
    notes: isPrimi
      ? "Primigravida. No past obstetric complications or surgical interventions on the uterus."
      : `Multigravida (G${gravida}P${para}). Previous pregnancy delivered full term. Uneventful postpartum course.`,
  };

  const familyHistory: FamilyPregnancyHistory = {
    familyPreEclampsia: false,
    familyDiabetes: false,
    familyTwins: false,
    familyGeneticAnomalies: false,
    familyHypertension: false,
    notes: "No reported first-degree family history of severe pre-eclampsia, eclampsia, early onset diabetes, or recurrent pregnancy loss.",
  };

  const scans: DiagnosticScanReport[] = [
    {
      id: `scan-${patientId}-1`,
      title: "First Trimester Viability & Dating USG",
      type: "sonography",
      date: "2026-06-15",
      gaWeeks: 8.5,
      findings: "Single live intrauterine pregnancy. Regular cardiac pulsation. Gestational sac well implanted in fundus. Crown-Rump Length (CRL) 19.2 mm. Healthy decidual reaction.",
      doctorOrLab: "MatruSetu District Sonography Centre",
      isAbnormal: false,
      keyMetrics: [
        { label: "CRL", value: "19.2", unit: "mm" },
        { label: "FHR", value: "156", unit: "bpm" },
        { label: "Sac", value: "Intrauterine" },
      ],
      svgImage: generateSonogramSvg("Dating & Viability", "8w 4d", "18g", "CRL 19.2mm"),
    },
    {
      id: `scan-${patientId}-2`,
      title: "Targeted TIFFA Level-II Anomaly Scan",
      type: "sonography",
      date: "2026-08-20",
      gaWeeks: 19.2,
      findings: "Detailed structural survey shows normal intracranial ventricular anatomy and 4-chamber cardiac view. Both fetal kidneys visualized. Placenta is Posterior, Grade I maturity (no previa). AFI 14.2 cm. EFW 305g.",
      doctorOrLab: "MatruSetu District Sonography Centre",
      isAbnormal: false,
      keyMetrics: [
        { label: "Placenta", value: "Posterior (Normal)" },
        { label: "AFI", value: "14.2", unit: "cm" },
        { label: "EFW", value: "305", unit: "g" },
      ],
      svgImage: generateSonogramSvg("TIFFA Scan", "19w 2d", "305g", "AFI 14.2cm"),
    },
    {
      id: `lab-${patientId}-3`,
      title: "PMSMA Antenatal Diagnostic & Blood Panel",
      type: "lab_report",
      date: "2026-09-10",
      findings: `Complete Blood Count (CBC): Hemoglobin 11.2 g/dL. Platelets 2.2 Lakhs. Blood Group confirmed ${rhNegative ? "Rh Negative" : "Rh Positive"}. Viral markers non-reactive. Urine: Albumin Nil, Sugar Nil.`,
      doctorOrLab: "Government Community Health Centre Lab",
      isAbnormal: rhNegative,
      keyMetrics: [
        { label: "Hemoglobin", value: "11.2", unit: "g/dL" },
        { label: "Rh Factor", value: rhNegative ? "Negative (Monitor)" : "Positive", alert: rhNegative },
        { label: "Urine Protein", value: "Nil" },
      ],
      svgImage: generateLabReportSvg("Antenatal Diagnostic & Blood Panel", "Hb: 11.2 g/dL · Platelets: 2.2L", `Blood Group: ${rhNegative ? "Rh Negative" : "Rh Positive"} · Urine: Nil`, "Routine Antenatal Lab Profile. Normal Range."),
    },
  ];

  return { pastHistory, familyHistory, scans };
}

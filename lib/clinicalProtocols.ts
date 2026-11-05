/**
 * Standard Antenatal Care (ANC) Protocols and Clinical Justifications.
 * Compliant with FOGSI (Federation of Obstetric and Gynaecological Societies of India),
 * MoHFW (Ministry of Health & Family Welfare, Government of India), and WHO Guidelines.
 */

export interface ClinicalProtocolItem {
  code: string;
  name: string;
  kind: "scan" | "test" | "injection" | "visit";
  windowStartWeek: number;
  windowEndWeek: number;
  condition: string | null;
  isCritical: boolean;
  sortOrder: number;
  clinicalRationale: string;
}

export interface RiskThresholdGuideline {
  atRiskDays: number;
  lostDays: number;
  clinicalRationale: string;
}

export const CLINICAL_SIGN_OFF_METADATA = {
  certifiedBy: null as string | null,
  version: "2026.1-ANC",
  lastReviewed: "2026-09-30",
  accreditation: "FOGSI Good Clinical Practice Recommendations & MoHFW Antenatal Care Guidelines",
  // Flip only once the Clinical Lead has actually signed off (see lib/clinical.ts).
  signedOff: false,
};

export const FOGSI_MOHFW_SCHEDULE_ITEMS: ClinicalProtocolItem[] = [
  {
    code: "booking",
    name: "Booking visit + labs (CBC, blood group/Rh, TSH, HIV, HBsAg, VDRL, HCV, urine, RBS)",
    kind: "test",
    windowStartWeek: 6,
    windowEndWeek: 12,
    condition: null,
    isCritical: true,
    sortOrder: 10,
    clinicalRationale:
      "Baseline maternal screening for anemia, blood typing, viral serology, thyroid dysfunction, and asymptomatic bacteriuria to establish safe prenatal trajectory.",
  },
  {
    code: "dating_scan",
    name: "Dating / viability scan (CRL measurement)",
    kind: "scan",
    windowStartWeek: 6,
    windowEndWeek: 10,
    condition: null,
    isCritical: true,
    sortOrder: 20,
    clinicalRationale:
      "Crown-Rump Length (CRL) in early first trimester provides the most accurate estimation of gestational age (error ±3-5 days), confirming intrauterine viability and chorionicity.",
  },
  {
    code: "nt_scan",
    name: "NT scan + double marker (Combined First Trimester Screening)",
    kind: "scan",
    windowStartWeek: 11,
    windowEndWeek: 13.85,
    condition: null,
    isCritical: true,
    sortOrder: 30,
    clinicalRationale:
      "Strict window: Fetal crown-rump length must be 45-84 mm. Nuchal translucency measurement combined with free β-hCG and PAPP-A detects Trisomy 21 (Down syndrome) with 85-90% sensitivity.",
  },
  {
    code: "td_1",
    name: "Td dose 1 (Tetanus-diphtheria toxoid)",
    kind: "injection",
    windowStartWeek: 16,
    windowEndWeek: 24,
    condition: null,
    isCritical: false,
    sortOrder: 40,
    clinicalRationale:
      "First dose of tetanus-diphtheria toxoid given early in second trimester under National Immunization Schedule.",
  },
  {
    code: "anomaly_scan",
    name: "Anomaly scan (TIFFA - Targeted Imaging for Fetal Anomalies)",
    kind: "scan",
    windowStartWeek: 18,
    windowEndWeek: 22,
    condition: null,
    isCritical: true,
    sortOrder: 50,
    clinicalRationale:
      "Optimal acoustic window for comprehensive structural survey (central nervous system, cardiac 4-chamber view, spine, abdominal wall, face, limbs, and placental localization before legal termination threshold).",
  },
  {
    code: "td_2",
    name: "Td dose 2 (4 weeks after dose 1)",
    kind: "injection",
    windowStartWeek: 20,
    windowEndWeek: 28,
    condition: null,
    isCritical: false,
    sortOrder: 60,
    clinicalRationale:
      "Second dose given at least 4 weeks after Td-1 to confer protective maternal and neonatal antitoxin levels against neonatal tetanus.",
  },
  {
    code: "ogtt",
    name: "OGTT (DIPSI / WHO 75g Oral Glucose Tolerance Test)",
    kind: "test",
    windowStartWeek: 24,
    windowEndWeek: 28,
    condition: null,
    isCritical: true,
    sortOrder: 70,
    clinicalRationale:
      "Peak placental lactogen and progesterone induce physiological insulin resistance at 24-28 weeks. Single-step non-fasting 75g oral glucose (2-hr plasma glucose ≥140 mg/dL diagnostic for Gestational Diabetes Mellitus).",
  },
  {
    code: "repeat_cbc",
    name: "Repeat CBC (Hemoglobin & Platelets)",
    kind: "test",
    windowStartWeek: 28,
    windowEndWeek: 28,
    condition: null,
    isCritical: false,
    sortOrder: 80,
    clinicalRationale:
      "Evaluates physiological hemodilution at maximum plasma volume expansion and checks response to prophylactic oral iron therapy before third trimester.",
  },
  {
    code: "anti_d",
    name: "Anti-D immunoglobulin (300 mcg)",
    kind: "injection",
    windowStartWeek: 28,
    windowEndWeek: 28,
    condition: "rh_negative",
    isCritical: true,
    sortOrder: 90,
    clinicalRationale:
      "Routine antenatal anti-D prophylaxis administered at 28 weeks to non-sensitized Rh-negative pregnant women prevents alloimmunization against fetal Rh-D antigens.",
  },
  {
    code: "tdap",
    name: "Tdap (Tetanus, Diphtheria, Pertussis)",
    kind: "injection",
    windowStartWeek: 27,
    windowEndWeek: 36,
    condition: null,
    isCritical: false,
    sortOrder: 100,
    clinicalRationale:
      "Optimal maternal transplacental IgG antibody transfer occurs between 27 and 36 weeks, providing critical passive immunity to protect the newborn from pertussis (whooping cough) in the first 2 months of life.",
  },
  {
    code: "growth_scan_1",
    name: "Growth scan + Umbilical Artery Doppler (Early T3)",
    kind: "scan",
    windowStartWeek: 28,
    windowEndWeek: 32,
    condition: null,
    isCritical: true,
    sortOrder: 110,
    clinicalRationale:
      "Assesses interval fetal growth trajectory, abdominal circumference (AC), estimated fetal weight (EFW), amniotic fluid index (AFI), and umbilical artery pulsatility index (PI) to detect late-onset FGR.",
  },
  {
    code: "growth_scan_2",
    name: "Growth scan + Doppler (Late T3 / Term evaluation)",
    kind: "scan",
    windowStartWeek: 34,
    windowEndWeek: 36,
    condition: null,
    isCritical: true,
    sortOrder: 120,
    clinicalRationale:
      "Near-term evaluation of fetal presentation, placental grading, oligohydramnios, and cerebroplacental ratio (CPR) to prepare for safe delivery planning.",
  },
];

export const CLINICAL_RISK_THRESHOLDS: RiskThresholdGuideline = {
  atRiskDays: 7,
  lostDays: 21,
  clinicalRationale:
    "Antenatal visits after 28 weeks occur every 2 weeks, and weekly after 36 weeks. A delay >7 days represents a missed surveillance window. A delay >21 days exposes the pregnancy to unmonitored severe pre-eclampsia, IUGR, or placental insufficiency, categorizing the patient as Lost to Follow-up requiring active tracing.",
};

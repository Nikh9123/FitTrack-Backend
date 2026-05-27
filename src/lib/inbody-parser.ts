/**
 * InBody OCR Parser Utilities
 * ----------------------------
 * Parses raw OCR text from InBody / body composition reports and extracts
 * structured metrics using regex patterns.  All values are returned as
 * strings so the caller / client can decide how to format / validate them.
 *
 * Handles noisy OCR output: spaces within numbers, InBody-specific layout,
 * mixed case, abbreviations, and various report formats.
 */

export interface ExtractedInBodyMetrics {
  // ── Core body composition ─────────────────────────────────────────────────
  weight?: string;
  bmi?: string;
  bodyFat?: string;           // PBF — percent body fat (%)
  bodyFatMass?: string;       // Body Fat Mass in kg
  skeletalMuscleMass?: string; // SMM in kg
  leanBodyMass?: string;      // Fat-free mass in kg
  fatFreeMass?: string;       // Same as lean body mass
  softLeanMass?: string;      // Soft Lean Mass in kg
  protein?: string;           // Protein in kg
  mineral?: string;           // Mineral in kg
  bodyWater?: string;         // Total Body Water in L

  // ── Metabolic ─────────────────────────────────────────────────────────────
  bmr?: string;               // Basal Metabolic Rate in kcal
  metabolicAge?: string;      // Metabolic Age in years
  recommendedCalorieIntake?: string; // Recommended daily kcal

  // ── Obesity & risk ────────────────────────────────────────────────────────
  visceralFat?: string;       // Visceral Fat Level (1-20)
  waistHipRatio?: string;     // WHR
  obesityDegree?: string;     // Obesity Degree %

  // ── Weight control ────────────────────────────────────────────────────────
  targetWeight?: string;      // Target weight in kg
  weightControl?: string;     // Weight to gain/lose in kg
  fatControl?: string;        // Fat to gain/lose in kg
  muscleControl?: string;     // Muscle to gain/lose in kg

  // ── Research parameters ───────────────────────────────────────────────────
  smi?: string;               // Skeletal Muscle Index kg/m²

  // ── Score & demographics ─────────────────────────────────────────────────
  inbodyScore?: string;
  height?: string;
  age?: string;
  gender?: string;
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function firstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const raw = (m[1] ?? m[0]).trim();
      const val = raw.replace(/(\d)\s+(\d)/g, "$1$2").replace(/(\d)\s*\.\s*(\d)/g, "$1.$2");
      if (val && val !== "" && /\d/.test(val)) return val;
    }
  }
  return undefined;
}

// ─── Normalise raw OCR text ───────────────────────────────────────────────────
export function normalizeOCRText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\s{2,}/g, " ")
    .replace(/[^\x20-\x7E\n]/g, " ")
    .toLowerCase();
}

// ─── Extract individual metrics ───────────────────────────────────────────────
export function extractMetrics(rawText: string): ExtractedInBodyMetrics {
  const t = normalizeOCRText(rawText);

  const metrics: ExtractedInBodyMetrics = {};

  // Weight (kg)
  metrics.weight = firstMatch(t, [
    /(?:body\s*)?weight[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /\bwt[\s.:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /weight[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /(\d{2,3}[\s]*\.[\s]*\d)\s*kg/i,
    /(\d{2,3})\s*kg/i,
  ]);

  // BMI
  metrics.bmi = firstMatch(t, [
    /\bbmi[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /body\s*mass\s*index[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Body Fat % — PBF (percent body fat), NOT body fat mass in kg
  metrics.bodyFat = firstMatch(t, [
    /\bpbf[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /percent\s*body\s*fat[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /body\s*fat\s*%[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /body\s*fat\s*percentage[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Body Fat Mass (kg)
  metrics.bodyFatMass = firstMatch(t, [
    /body\s*fat\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /fat\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /where\s*my\s*excess\s*energy[^:]*[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Skeletal Muscle Mass (SMM)
  metrics.skeletalMuscleMass = firstMatch(t, [
    /skeletal\s*muscle\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\bsmm[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /muscle\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /skeletal\s*muscle[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Lean Body Mass / Fat-Free Mass
  metrics.leanBodyMass = firstMatch(t, [
    /lean\s*body\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /fat[\s-]free\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\bffm[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /lean\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  metrics.fatFreeMass = metrics.leanBodyMass ?? firstMatch(t, [
    /fat[\s-]free\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\bffm[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Soft Lean Mass
  metrics.softLeanMass = firstMatch(t, [
    /soft\s*lean\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\bslm[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Protein
  metrics.protein = firstMatch(t, [
    /protein[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /(?:what\s*i\s*need\s*to\s*build\s*muscles[^:]*[\s:]|protein[\s:])(\d[\d\s]*\.?\s*\d*)/i,
    /protein[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Mineral
  metrics.mineral = firstMatch(t, [
    /mineral[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i,
    /(?:what\s*i\s*need\s*for\s*strong\s*bones[^:]*[\s:]|mineral[\s:])(\d[\d\s]*\.?\s*\d*)/i,
    /mineral[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Body Water
  metrics.bodyWater = firstMatch(t, [
    /(?:total\s*)?body\s*water[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\btbw[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /water[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Basal Metabolic Rate (BMR)
  metrics.bmr = firstMatch(t, [
    /\bbmr[\s:]+(\d[\d\s]{2,5})\s*(?:kcal|kj)?/i,
    /basal\s*metabolic\s*rate[\s:]+(\d[\d\s]{2,5})/i,
    /basal\s*metabolism[\s:]+(\d[\d\s]{2,5})/i,
  ]);

  // Visceral Fat Level
  metrics.visceralFat = firstMatch(t, [
    /visceral\s*fat[\s:]+(?:level\s*)?(\d[\d\s]*\.?\s*\d*)/i,
    /visceral\s*fat\s*(?:level|rating|area)[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /level\s*(\d{1,2})\s*(?:high|low)?/i,
  ]);

  // Metabolic Age
  metrics.metabolicAge = firstMatch(t, [
    /metabolic\s*age[\s:]+(\d{1,3})/i,
    /metabolism\s*age[\s:]+(\d{1,3})/i,
    /met\s*age[\s:]+(\d{1,3})/i,
  ]);

  // Waist-Hip Ratio
  metrics.waistHipRatio = firstMatch(t, [
    /waist[\s-]hip\s*ratio[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /\bwhr[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /waist\s*to\s*hip[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Obesity Degree
  metrics.obesityDegree = firstMatch(t, [
    /obesity\s*degree[\s:]+(\d[\d\s]*\.?\s*\d*)\s*%?/i,
    /\bpof[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Recommended Calorie Intake
  metrics.recommendedCalorieIntake = firstMatch(t, [
    /recommended\s*calorie\s*intake[\s:]+(\d[\d\s]{3,5})\s*(?:kcal)?/i,
    /calorie\s*intake[\s:]+(\d[\d\s]{3,5})/i,
    /recommended\s*caloric\s*intake[\s:]+(\d[\d\s]{3,5})/i,
  ]);

  // Target Weight
  metrics.targetWeight = firstMatch(t, [
    /target\s*weight[\s:]+(\d[\d\s]*\.?\s*\d*)\s*(?:kg)?/i,
  ]);

  // Weight Control (how much to gain/lose)
  metrics.weightControl = firstMatch(t, [
    /weight\s*control[\s:]+(-?\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Fat Control
  metrics.fatControl = firstMatch(t, [
    /fat\s*control[\s:]+(-?\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // Muscle Control
  metrics.muscleControl = firstMatch(t, [
    /muscle\s*control[\s:]+(-?\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // SMI (Skeletal Muscle Index)
  metrics.smi = firstMatch(t, [
    /\bsmi[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
    /skeletal\s*muscle\s*index[\s:]+(\d[\d\s]*\.?\s*\d*)/i,
  ]);

  // InBody Score
  metrics.inbodyScore = firstMatch(t, [
    /inbody\s*score[\s:]+(\d+)\s*\/?\s*100/i,
    /score[\s:]+(\d+)\s*\/\s*100/i,
  ]);

  // Height
  metrics.height = firstMatch(t, [
    /height[\s:]+(\d{2,3})\s*cm/i,
    /(\d{3})\s*cm/i,
  ]);

  // Age
  metrics.age = firstMatch(t, [
    /age[\s:]+(\d{1,3})/i,
  ]);

  // Gender
  const genderMatch = t.match(/gender[\s:]+(\w+)/i) ?? t.match(/\b(male|female)\b/i);
  if (genderMatch) {
    const g = (genderMatch[1] ?? genderMatch[0]).toLowerCase();
    if (g === "male" || g === "female") metrics.gender = g;
  }

  // Remove undefined keys
  return Object.fromEntries(
    Object.entries(metrics).filter(([, v]) => v !== undefined),
  ) as ExtractedInBodyMetrics;
}

// ─── Quality check ────────────────────────────────────────────────────────────
export function isValidExtraction(metrics: ExtractedInBodyMetrics): boolean {
  const coreFields = ["weight", "bmi", "bodyFat", "skeletalMuscleMass", "bmr", "visceralFat"];
  return coreFields.filter((f) => !!(metrics as Record<string, string | undefined>)[f]).length >= 2;
}

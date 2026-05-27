/**
 * Groq AI Service for InBody Analysis
 * ------------------------------------
 * Uses Groq (llama models) to generate structured fitness insights.
 * Returns clean JSON matching the GeminiAnalysis schema.
 */

import Groq from "groq-sdk";
import { logger } from "./logger";

const GROQ_API_KEY = process.env.GROQ_API_KEY;

const DEFAULT_GROQ_MODEL = "llama-3.1-8b-instant";
const FALLBACK_GROQ_MODEL = "llama-3.3-70b-versatile";

const MAX_OCR_CHARS_FOR_AI = 5000;
const MAX_AI_OUTPUT_TOKENS = 3000;

const LOG_GROQ_RAW_RESPONSE = process.env.LOG_GROQ_RAW_RESPONSE === "true";
const GROQ_MODEL = selectGroqModel(process.env.GROQ_MODEL);

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

// ─── Schema ───────────────────────────────────────────────────────────────────

export interface GeminiAnalysis {
  overallSummary: string;
  fitnessLevel: string;

  bodyFatAnalysis: {
    status: string;
    description: string;
    recommendation: string;
    idealRange: string;
  };
  muscleMassAnalysis: {
    status: string;
    description: string;
    recommendation: string;
    idealRange: string;
  };
  metabolismInsights: {
    bmr: string;
    metabolicAge: string;
    description: string;
    recommendation: string;
  };
  visceralFatAnalysis: {
    level: string;
    risk: string;
    recommendation: string;
    whrImplication: string;
  };
  bodyCompositionAnalysis: {
    hydrationStatus: string;
    proteinStatus: string;
    mineralStatus: string;
    description: string;
    recommendation: string;
  };
  obesityAnalysis: {
    bmiStatus: string;
    pbfStatus: string;
    obesityDegreeInterpretation: string;
    riskLevel: string;
    description: string;
    recommendation: string;
  };
  weightControlAnalysis: {
    targetWeight: string;
    estimatedWeightToLose: string;
    estimatedFatToLose: string;
    timeline: string;
    strategy: string;
  };
  metabolicHealthAnalysis: {
    description: string;
    bmrInterpretation: string;
    metabolicAgeInterpretation: string;
    recommendation: string;
  };
  recompositionGoals: {
    shortTerm: string;
    mediumTerm: string;
    longTerm: string;
  };

  strengths: string[];
  weaknesses: string[];
  healthRisks: string[];
  recommendations: string[];

  workoutPlan: {
    goal: string;
    planType: string;
    weeklySchedule: Array<{
      day: string;
      focus: string;
      duration: string;
      exercises?: string[];
    }>;
    cardioRecommendation: string;
  };

  goalSuggestions: string[];

  __aiSource?: "groq" | "fallback";
  __aiModel?: string;
  __aiRawResponse?: string;
  __aiUsage?: unknown;
}

// ─── Compact metrics type passed to AI ───────────────────────────────────────

type CompactInBodyMetrics = {
  weight?: string;
  height?: string;
  age?: string;
  gender?: string;
  bmi?: string;
  bodyFat?: string;
  bodyFatMass?: string;
  skeletalMuscle?: string;
  leanBodyMass?: string;
  fatFreeMass?: string;
  softLeanMass?: string;
  protein?: string;
  mineral?: string;
  bodyWater?: string;
  bmr?: string;
  visceralFat?: string;
  metabolicAge?: string;
  waistHipRatio?: string;
  obesityDegree?: string;
  recommendedCalorieIntake?: string;
  targetWeight?: string;
  weightControl?: string;
  fatControl?: string;
  muscleControl?: string;
  smi?: string;
  inbodyScore?: string;
};

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert InBody body composition analysis AI — equivalent to a professional fitness doctor and sports scientist combined.

CRITICAL RULES:
- Return ONLY valid JSON. Never return markdown, explanation, or prose outside JSON.
- Never omit any field from the schema — use "" for unknown strings, "0" for unknown numbers.
- Keep descriptions 2-3 sentences: clinical, specific, actionable.
- Use actual metric values in descriptions (e.g. "Your visceral fat level of 22 is critically high").
- Never return incomplete JSON.

NUMERIC-ONLY FIELDS (must contain ONLY a number as a string):
- metabolismInsights.bmr → e.g. "1756"
- metabolismInsights.metabolicAge → e.g. "154"
- visceralFatAnalysis.level → e.g. "22"

Return this EXACT JSON schema (no extra fields, no missing fields):
{
  "overallSummary": "",
  "fitnessLevel": "",
  "bodyFatAnalysis": {
    "status": "",
    "description": "",
    "recommendation": "",
    "idealRange": ""
  },
  "muscleMassAnalysis": {
    "status": "",
    "description": "",
    "recommendation": "",
    "idealRange": ""
  },
  "metabolismInsights": {
    "bmr": "",
    "metabolicAge": "",
    "description": "",
    "recommendation": ""
  },
  "visceralFatAnalysis": {
    "level": "",
    "risk": "",
    "recommendation": "",
    "whrImplication": ""
  },
  "bodyCompositionAnalysis": {
    "hydrationStatus": "",
    "proteinStatus": "",
    "mineralStatus": "",
    "description": "",
    "recommendation": ""
  },
  "obesityAnalysis": {
    "bmiStatus": "",
    "pbfStatus": "",
    "obesityDegreeInterpretation": "",
    "riskLevel": "",
    "description": "",
    "recommendation": ""
  },
  "weightControlAnalysis": {
    "targetWeight": "",
    "estimatedWeightToLose": "",
    "estimatedFatToLose": "",
    "timeline": "",
    "strategy": ""
  },
  "metabolicHealthAnalysis": {
    "description": "",
    "bmrInterpretation": "",
    "metabolicAgeInterpretation": "",
    "recommendation": ""
  },
  "recompositionGoals": {
    "shortTerm": "",
    "mediumTerm": "",
    "longTerm": ""
  },
  "strengths": [""],
  "weaknesses": [""],
  "healthRisks": [""],
  "recommendations": [""],
  "workoutPlan": {
    "goal": "",
    "planType": "",
    "weeklySchedule": [{ "day": "", "focus": "", "duration": "", "exercises": [""] }],
    "cardioRecommendation": ""
  },
  "goalSuggestions": [""]
}`;

// ─── Main export ──────────────────────────────────────────────────────────────

export async function analyzeWithGemini(
  metrics: Record<string, string | undefined>,
  userProfile?: {
    age?: number;
    gender?: string;
    height?: string;
    fitnessGoal?: string;
  },
  rawOCRText = "",
): Promise<GeminiAnalysis> {
  if (!groq || !GROQ_API_KEY) {
    logger.warn("GROQ_API_KEY missing — using fallback analysis");
    return withAiDebug(getDemoAnalysis(metrics), {
      source: "fallback",
      model: GROQ_MODEL,
      rawResponse: "",
      usage: undefined,
    });
  }

  const cleanedOCRText = cleanOCRText(rawOCRText);
  const trimmedOCRText = cleanedOCRText.slice(0, MAX_OCR_CHARS_FOR_AI);

  const ocrMetrics = extractImportantMetricsFromOCR(trimmedOCRText);
  const compactMetrics: CompactInBodyMetrics = {
    ...ocrMetrics,
    ...toCompactMetrics(metrics),
  };

  const payload = {
    metrics: compactMetrics,
    userProfile: userProfile ?? null,
    ocrExcerpt: hasEnoughCompactMetrics(compactMetrics) ? undefined : trimmedOCRText,
  };

  const prompt = `Analyze this InBody body composition report in full professional detail:\n\n${JSON.stringify(payload, null, 2)}

Focus on:
- Why each metric is concerning or healthy with exact values
- Obesity risk, visceral fat danger, muscle imbalance
- Fat distribution patterns from WHR and body fat mass
- Metabolic health based on BMR and metabolic age  
- Hydration, protein, mineral status from body composition
- Realistic, specific recomposition timeline
- Weight control targets vs actual values
- All analysis sections must reference actual numbers from the report`;

  logger.info(
    { payloadSize: prompt.length, selectedModel: GROQ_MODEL },
    "Prepared Groq payload",
  );

  try {
    const result = await requestGroqAnalysis(prompt, GROQ_MODEL);
    return withAiDebug(result.analysis, {
      source: "groq",
      model: GROQ_MODEL,
      rawResponse: result.rawResponse,
      usage: result.usage,
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "Primary model failed, trying fallback");
  }

  try {
    const result = await requestGroqAnalysis(prompt, FALLBACK_GROQ_MODEL);
    return withAiDebug(result.analysis, {
      source: "groq",
      model: FALLBACK_GROQ_MODEL,
      rawResponse: result.rawResponse,
      usage: result.usage,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Fallback model also failed");
    return withAiDebug(getDemoAnalysis(metrics), {
      source: "fallback",
      model: FALLBACK_GROQ_MODEL,
      rawResponse: "",
      usage: undefined,
    });
  }
}

export function cleanOCRText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\x20-\x7E\n%]/g, " ")
    .replace(/[|_~`^={}\[\]\\<>]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function selectGroqModel(model?: string): string {
  if (!model || model === "openai/gpt-oss-120b") return DEFAULT_GROQ_MODEL;
  return model;
}

function toCompactMetrics(
  metrics: Record<string, string | undefined>,
): CompactInBodyMetrics {
  return {
    weight: metrics.weight,
    height: metrics.height,
    age: metrics.age,
    gender: metrics.gender,
    bmi: metrics.bmi,
    bodyFat: metrics.bodyFat,
    bodyFatMass: metrics.bodyFatMass,
    skeletalMuscle: metrics.skeletalMuscleMass,
    leanBodyMass: metrics.leanBodyMass,
    fatFreeMass: metrics.fatFreeMass,
    softLeanMass: metrics.softLeanMass,
    protein: metrics.protein,
    mineral: metrics.mineral,
    bodyWater: metrics.bodyWater,
    bmr: metrics.bmr,
    visceralFat: metrics.visceralFat,
    metabolicAge: metrics.metabolicAge,
    waistHipRatio: metrics.waistHipRatio,
    obesityDegree: metrics.obesityDegree,
    recommendedCalorieIntake: metrics.recommendedCalorieIntake,
    targetWeight: metrics.targetWeight,
    weightControl: metrics.weightControl,
    fatControl: metrics.fatControl,
    muscleControl: metrics.muscleControl,
    smi: metrics.smi,
    inbodyScore: metrics.inbodyScore,
  };
}

function extractImportantMetricsFromOCR(text: string): CompactInBodyMetrics {
  const n = text.toLowerCase();

  function pick(patterns: RegExp[]): string | undefined {
    for (const p of patterns) {
      const m = n.match(p);
      if (m?.[1]) {
        const cleaned = m[1]
          .replace(/(\d)\s*\.\s*(\d)/g, "$1.$2")
          .replace(/(\d)\s+(\d)/g, "$1$2")
          .trim();
        if (/^\d+(\.\d+)?$/.test(cleaned)) return cleaned;
      }
    }
    return undefined;
  }

  return {
    weight: pick([/weight[\s:]+(\d[\d\s]*\.?\s*\d*)\s*kg/i, /weight[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    bmi: pick([/\bbmi[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    bodyFat: pick([/\bpbf[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /body\s*fat[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    bodyFatMass: pick([/body\s*fat\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /fat\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    skeletalMuscle: pick([/\bsmm[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /skeletal\s*muscle[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    leanBodyMass: pick([/lean\s*body\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /fat[\s-]free\s*mass[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    protein: pick([/protein[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    mineral: pick([/mineral[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    bodyWater: pick([/(?:total\s*)?body\s*water[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /\btbw[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    bmr: pick([/\bbmr[\s:]+(\d[\d\s]{2,5})/i, /basal\s*metabolic\s*rate[\s:]+(\d[\d\s]{2,5})/i]),
    visceralFat: pick([/visceral\s*fat[\s:]+(?:level\s*)?(\d[\d\s]*\.?\s*\d*)/i]),
    metabolicAge: pick([/metabolic\s*age[\s:]+(\d{1,3})/i]),
    waistHipRatio: pick([/waist[\s-]hip\s*ratio[\s:]+(\d[\d\s]*\.?\s*\d*)/i, /\bwhr[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    obesityDegree: pick([/obesity\s*degree[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    targetWeight: pick([/target\s*weight[\s:]+(\d[\d\s]*\.?\s*\d*)/i]),
    recommendedCalorieIntake: pick([/recommended\s*calorie\s*intake[\s:]+(\d[\d\s]{3,5})/i]),
  };
}

function hasEnoughCompactMetrics(metrics: CompactInBodyMetrics): boolean {
  return Object.values(metrics).filter(Boolean).length >= 4;
}

async function requestGroqAnalysis(
  prompt: string,
  model: string,
): Promise<{ analysis: GeminiAnalysis; rawResponse: string; usage: unknown }> {
  if (!groq) throw new Error("Groq client missing");

  const message = await groq.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    model,
    temperature: 0.3,
    max_tokens: MAX_AI_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
  });

  const rawText = message.choices[0]?.message?.content ?? "";

  if (LOG_GROQ_RAW_RESPONSE) {
    logger.info({ rawText, usage: message.usage }, "Groq raw response");
  }

  if (!rawText) throw new Error("Empty AI response");

  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Invalid JSON response");

  const parsed = JSON.parse(jsonMatch[0]) as GeminiAnalysis;

  // ── Ensure all required top-level sections exist ──────────────────────────
  parsed.metabolismInsights = parsed.metabolismInsights ?? { bmr: "", metabolicAge: "", description: "", recommendation: "" };
  parsed.visceralFatAnalysis = parsed.visceralFatAnalysis ?? { level: "", risk: "", recommendation: "", whrImplication: "" };
  parsed.bodyFatAnalysis = parsed.bodyFatAnalysis ?? { status: "", description: "", recommendation: "", idealRange: "" };
  parsed.muscleMassAnalysis = parsed.muscleMassAnalysis ?? { status: "", description: "", recommendation: "", idealRange: "" };
  parsed.bodyCompositionAnalysis = parsed.bodyCompositionAnalysis ?? { hydrationStatus: "", proteinStatus: "", mineralStatus: "", description: "", recommendation: "" };
  parsed.obesityAnalysis = parsed.obesityAnalysis ?? { bmiStatus: "", pbfStatus: "", obesityDegreeInterpretation: "", riskLevel: "", description: "", recommendation: "" };
  parsed.weightControlAnalysis = parsed.weightControlAnalysis ?? { targetWeight: "", estimatedWeightToLose: "", estimatedFatToLose: "", timeline: "", strategy: "" };
  parsed.metabolicHealthAnalysis = parsed.metabolicHealthAnalysis ?? { description: "", bmrInterpretation: "", metabolicAgeInterpretation: "", recommendation: "" };
  parsed.recompositionGoals = parsed.recompositionGoals ?? { shortTerm: "", mediumTerm: "", longTerm: "" };

  // ── Sanitize numeric-only fields ──────────────────────────────────────────
  parsed.metabolismInsights.bmr = extractNumber(parsed.metabolismInsights.bmr);
  parsed.metabolismInsights.metabolicAge = extractNumber(parsed.metabolismInsights.metabolicAge);
  parsed.visceralFatAnalysis.level = extractNumber(parsed.visceralFatAnalysis.level);

  // ── Ensure arrays ─────────────────────────────────────────────────────────
  parsed.strengths = ensureArray(parsed.strengths);
  parsed.weaknesses = ensureArray(parsed.weaknesses);
  parsed.healthRisks = ensureArray(parsed.healthRisks);
  parsed.recommendations = ensureArray(parsed.recommendations);
  parsed.goalSuggestions = ensureArray(parsed.goalSuggestions);

  if (!parsed.workoutPlan) {
    parsed.workoutPlan = { goal: "", planType: "", weeklySchedule: [], cardioRecommendation: "" };
  }
  parsed.workoutPlan.weeklySchedule = ensureArray(parsed.workoutPlan.weeklySchedule);

  return { analysis: parsed, rawResponse: rawText, usage: message.usage };
}

function extractNumber(value: string | undefined): string {
  if (!value) return "";
  const match = String(value).match(/\d+(\.\d+)?/);
  return match?.[0] ?? "";
}

function ensureArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function withAiDebug(
  analysis: GeminiAnalysis,
  debug: { source: "groq" | "fallback"; model: string; rawResponse: string; usage: unknown },
): GeminiAnalysis {
  return { ...analysis, __aiSource: debug.source, __aiModel: debug.model, __aiRawResponse: debug.rawResponse, __aiUsage: debug.usage };
}

function getDemoAnalysis(metrics: Record<string, string | undefined>): GeminiAnalysis {
  const weight = parseFloat(metrics.weight ?? "109.6");
  const bodyFat = parseFloat(metrics.bodyFat ?? "41.5");
  const bmi = parseFloat(metrics.bmi ?? "33.8");
  const smm = parseFloat(metrics.skeletalMuscleMass ?? "36.2");
  const bmr = parseInt(metrics.bmr ?? "1756", 10);
  const visceralFat = parseInt(metrics.visceralFat ?? "22", 10);
  const metabolicAge = metrics.metabolicAge ?? "154";
  const whr = parseFloat(metrics.waistHipRatio ?? "1.14");
  const targetWeight = parseFloat(metrics.targetWeight ?? "75.5");

  const bodyFatStatus = bodyFat < 15 ? "Low" : bodyFat < 22 ? "Optimal" : bodyFat < 28 ? "High" : bodyFat < 35 ? "Very High" : "Severely High";
  const bmiStatus = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal" : bmi < 30 ? "Overweight" : "Obese";

  return {
    overallSummary: `Body composition indicates significant health concerns with ${bodyFat}% body fat and visceral fat level ${visceralFat}/20. Priority is structured fat loss while preserving skeletal muscle mass of ${smm} kg. Metabolic age of ${metabolicAge} years signals urgent need for lifestyle intervention.`,
    fitnessLevel: bodyFat < 20 ? "Intermediate" : bodyFat < 30 ? "Beginner" : "Needs Attention",

    bodyFatAnalysis: {
      status: bodyFatStatus,
      description: `At ${bodyFat}% body fat, you are in the ${bodyFatStatus.toLowerCase()} range. This significantly elevates risk for cardiovascular disease, diabetes, and metabolic syndrome.`,
      recommendation: "Combine a 500-kcal daily deficit with strength training 4x weekly and 150+ minutes of cardio per week.",
      idealRange: "Male: 10-20% | Female: 18-28%",
    },
    muscleMassAnalysis: {
      status: smm > 40 ? "High" : smm > 33 ? "Average" : smm > 28 ? "Below Average" : "Low",
      description: `Skeletal muscle mass of ${smm} kg needs improvement relative to body weight. Low muscle mass combined with high body fat creates an unfavourable muscle-to-fat ratio.`,
      recommendation: "Progressive resistance training with compound lifts (squats, deadlifts, rows) 4x weekly. Aim for 1.8-2.2g protein per kg body weight.",
      idealRange: "Male: 33-39 kg | Female: 21-27 kg",
    },
    metabolismInsights: {
      bmr: String(bmr),
      metabolicAge: String(metabolicAge),
      description: `BMR of ${bmr} kcal means your body burns this at complete rest. Metabolic age of ${metabolicAge} yr is significantly above actual age, indicating metabolic slowdown driven by excess body fat.`,
      recommendation: "Build muscle mass to increase BMR. Every kg of muscle adds ~13 kcal/day to resting metabolism.",
    },
    visceralFatAnalysis: {
      level: String(visceralFat),
      risk: visceralFat <= 9 ? "Low" : visceralFat <= 14 ? "Moderate" : "High",
      recommendation: `Visceral fat level ${visceralFat} is ${visceralFat > 14 ? "critically" : "dangerously"} high. Prioritise cardio (minimum 150 min/week), reduce sugar intake, and intermittent fasting can accelerate visceral fat reduction.`,
      whrImplication: `WHR of ${whr} indicates ${whr > 1.0 ? "central obesity with high cardiovascular risk" : whr > 0.9 ? "abdominal obesity with moderate risk" : "acceptable fat distribution"}. Central fat distribution is the most dangerous type.`,
    },
    bodyCompositionAnalysis: {
      hydrationStatus: "Within Range",
      proteinStatus: "Adequate",
      mineralStatus: "Within Range",
      description: `Body composition breakdown shows excess fat mass relative to lean components. Total body water and protein levels indicate adequate hydration and protein stores despite high overall weight.`,
      recommendation: "Maintain hydration at 3+ litres/day. Increase dietary protein to 2g/kg to protect muscle during fat loss phase.",
    },
    obesityAnalysis: {
      bmiStatus: bmiStatus,
      pbfStatus: bodyFatStatus,
      obesityDegreeInterpretation: metrics.obesityDegree ? `Obesity degree of ${metrics.obesityDegree}% indicates body fat exceeds ideal by this margin.` : "Obesity degree not measured.",
      riskLevel: bmi > 35 || bodyFat > 40 ? "Very High" : bmi > 30 || bodyFat > 30 ? "High" : "Moderate",
      description: `BMI of ${bmi} (${bmiStatus}) combined with ${bodyFat}% body fat places you at elevated risk for type 2 diabetes, hypertension, sleep apnea, and cardiovascular disease.`,
      recommendation: "Target 0.5-1 kg weight loss per week through combined diet and exercise. Avoid crash diets which accelerate muscle loss.",
    },
    weightControlAnalysis: {
      targetWeight: String(targetWeight),
      estimatedWeightToLose: String(Math.round(weight - targetWeight)),
      estimatedFatToLose: String(Math.round((weight - targetWeight) * 0.85)),
      timeline: `${Math.ceil((weight - targetWeight) * 2)} to ${Math.ceil((weight - targetWeight) * 4)} weeks at 0.5-1 kg/week`,
      strategy: "Structured caloric deficit of 500-750 kcal/day combined with progressive resistance training to preserve lean mass while losing fat.",
    },
    metabolicHealthAnalysis: {
      description: `Metabolic profile shows a BMR of ${bmr} kcal with a metabolic age ${parseInt(metabolicAge, 10) > 50 ? "severely" : "significantly"} higher than chronological age. This indicates metabolic dysfunction driven by excess adipose tissue.`,
      bmrInterpretation: `BMR of ${bmr} kcal is ${bmr < 1600 ? "low" : bmr < 2000 ? "moderate" : "high"} for your body weight. Building muscle will increase this figure, making weight maintenance easier long-term.`,
      metabolicAgeInterpretation: `Metabolic age of ${metabolicAge} yr compared to actual age suggests the body's internal systems are aging faster than chronological age. Fat loss and muscle gain directly reverse this.`,
      recommendation: "Combine resistance training with adequate sleep (7-8 hours) and stress management to optimise hormone levels and metabolic function.",
    },
    recompositionGoals: {
      shortTerm: `4-8 weeks: Lose 4-8 kg fat, establish consistent training habit, reduce visceral fat level from ${visceralFat} to below ${Math.max(visceralFat - 3, 10)}`,
      mediumTerm: `3-6 months: Reduce body fat to below ${Math.max(bodyFat - 10, 20)}%, reach ${Math.round(weight - (weight - targetWeight) * 0.5)} kg, improve metabolic age by 20-30 years`,
      longTerm: `6-12 months: Reach target weight of ${targetWeight} kg, body fat below 25%, normalize visceral fat to safe range (< 10), metabolic age aligned with actual age`,
    },

    strengths: [
      `Skeletal muscle mass of ${smm} kg provides metabolic foundation`,
      "Body water levels indicate adequate hydration",
      "BMR supports daily caloric needs",
    ],
    weaknesses: [
      `Body fat at ${bodyFat}% — ${bodyFatStatus.toLowerCase()} range`,
      `Visceral fat level ${visceralFat} — critically high cardiovascular risk`,
      `Metabolic age ${metabolicAge} yr — significantly above actual age`,
      `BMI ${bmi} — ${bmiStatus} classification`,
    ],
    healthRisks: [
      "High risk of type 2 diabetes due to excess visceral fat",
      "Elevated cardiovascular disease risk from central obesity",
      "Sleep apnea risk associated with high BMI and visceral fat",
      "Metabolic syndrome — multiple risk factors present simultaneously",
      "Joint stress from excess body weight",
    ],
    recommendations: [
      `Create 500-750 kcal daily deficit targeting ${Math.round(weight - targetWeight)} kg total loss`,
      "Strength train 4x weekly with progressive overload to protect and build muscle",
      "150+ minutes moderate cardio per week (brisk walking, cycling, swimming)",
      `Consume ${Math.round(weight * 1.8)}-${Math.round(weight * 2.2)}g protein daily`,
      "Reduce refined carbohydrates, sugar, and processed foods",
      "Monitor visceral fat with monthly InBody scans",
    ],
    workoutPlan: {
      goal: "Fat Loss + Muscle Preservation",
      planType: "Recomposition",
      weeklySchedule: [
        { day: "Monday", focus: "Lower Body Strength", duration: "60 min", exercises: ["Squats", "Leg Press", "Romanian Deadlift", "Calf Raises"] },
        { day: "Tuesday", focus: "Cardio — Moderate", duration: "45 min", exercises: ["Brisk Walk / Cycle", "Incline Treadmill"] },
        { day: "Wednesday", focus: "Upper Body Push", duration: "55 min", exercises: ["Chest Press", "Shoulder Press", "Tricep Extension", "Cable Flyes"] },
        { day: "Thursday", focus: "HIIT + Core", duration: "35 min", exercises: ["Burpees", "Mountain Climbers", "Planks", "Jump Rope"] },
        { day: "Friday", focus: "Upper Body Pull", duration: "55 min", exercises: ["Lat Pulldown", "Cable Row", "Face Pulls", "Bicep Curls"] },
        { day: "Saturday", focus: "Active Recovery", duration: "30 min", exercises: ["Yoga", "Light Walk", "Stretching"] },
        { day: "Sunday", focus: "Rest", duration: "—" },
      ],
      cardioRecommendation: "3x weekly: 2x moderate-intensity (40-45 min brisk walk/cycle) + 1x HIIT (25-30 min). Prioritise low-impact initially to protect joints.",
    },
    goalSuggestions: [
      `Reach ${targetWeight} kg target weight in ${Math.ceil((weight - targetWeight) * 3)} weeks`,
      "Reduce body fat to below 25% through structured recomposition",
      "Lower visceral fat level to safe range (below 10)",
      "Improve metabolic age by 30+ years through fat loss and muscle gain",
      "Achieve BMI below 25 (Normal range)",
    ],
  };
}

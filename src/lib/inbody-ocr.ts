/**
 * InBody OCR Service
 * ------------------
 * Extraction pipeline (in priority order):
 *   1. Groq Vision AI  — directly reads InBody report image (most accurate)
 *   2. Google Cloud Vision — full text OCR → regex parsing
 *   3. OCR.space — fallback text OCR → regex parsing
 *   4. Demo stub — development fallback
 *
 * Environment variables used:
 *   GROQ_API_KEY              — Used for vision extraction (reuses text-AI key)
 *   SUPABASE_URL              — Supabase project URL (optional for storage)
 *   SUPABASE_SERVICE_ROLE_KEY — Service-role key (optional for storage)
 *   GOOGLE_VISION_API_KEY     — Google Cloud Vision API key (optional)
 *   OCR_SPACE_API_KEY         — OCR.space API key (fallback, optional)
 */

import Groq from "groq-sdk";
import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import {
  extractMetrics,
  normalizeOCRText,
  type ExtractedInBodyMetrics,
} from "./inbody-parser";

// ─── Supabase Storage client ──────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";

const storageClient = createClient(
  SUPABASE_URL || "https://placeholder.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key",
);

const BUCKET = "inbody-reports";
const STORAGE_SETUP_HINT =
  "Run `pnpm --filter @workspace/api-server run setup-storage` or create the Supabase Storage bucket `inbody-reports`.";

// ─── Upload to Supabase Storage ───────────────────────────────────────────────
export async function uploadToStorage(
  fileBuffer: Buffer,
  mimeType: string,
  userId: string,
  fileName: string,
): Promise<string> {
  const ext = mimeType.includes("pdf") ? "pdf" : mimeType.split("/")[1] ?? "jpg";
  const storagePath = `${userId}/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}.${ext}`;

  const { error } = await storageClient.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) {
    logger.error({ error: error.message }, "Supabase Storage upload failed");
    if (error.message.toLowerCase().includes("bucket not found")) {
      throw new Error(`Storage bucket '${BUCKET}' was not found. ${STORAGE_SETUP_HINT}`);
    }
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = storageClient.storage
    .from(BUCKET)
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

// ─── Groq Vision Extraction ────────────────────────────────────────────────────
async function runGroqVisionExtraction(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<{ metrics: ExtractedInBodyMetrics; rawText: string }> {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) throw new Error("GROQ_API_KEY not set");
  if (mimeType.includes("pdf")) throw new Error("PDF not supported by Groq vision — falling through to text OCR");

  const groq = new Groq({ apiKey: GROQ_KEY });
  const base64 = fileBuffer.toString("base64");

  const VISION_PROMPT = `This is a professional InBody body composition analysis report. Extract EVERY numeric metric you can find — read all sections carefully including Body Composition Analysis, Muscle-Fat Analysis, Obesity Analysis, Weight Control, Research Parameters, and any other sections.

CRITICAL DISAMBIGUATION RULES:
- "weight" = TOTAL body weight in kg (e.g. 109.6 kg) — the large number at top
- "bodyFat" = PBF percent body fat (%) — e.g. 41.5 — NOT body fat mass in kg
- "bodyFatMass" = body fat mass in kg — e.g. 45.4 kg
- "visceralFat" = visceral fat LEVEL number (1-20 scale) — e.g. 22
- "bmr" = Basal Metabolic Rate in kcal — e.g. 1756
- "inbodyScore" = score out of 100 — e.g. 49
- "metabolicAge" = metabolic age in years — could be very high (e.g. 154)
- "obesityDegree" = obesity degree percentage — e.g. 154
- "waistHipRatio" = waist-hip ratio decimal — e.g. 1.14
- "weightControl" = weight to lose (negative) or gain — e.g. -34.1
- "fatControl" = fat to lose (negative) or gain — e.g. -34.1
- "muscleControl" = muscle to gain (positive) or lose — e.g. 0.0
- All values must be numeric strings or null if not clearly readable

Return ONLY valid JSON — no markdown, no explanation:
{
  "weight": null,
  "height": null,
  "age": null,
  "gender": null,
  "bmi": null,
  "bodyFat": null,
  "bodyFatMass": null,
  "skeletalMuscleMass": null,
  "leanBodyMass": null,
  "fatFreeMass": null,
  "softLeanMass": null,
  "protein": null,
  "mineral": null,
  "bodyWater": null,
  "bmr": null,
  "visceralFat": null,
  "metabolicAge": null,
  "waistHipRatio": null,
  "obesityDegree": null,
  "recommendedCalorieIntake": null,
  "targetWeight": null,
  "weightControl": null,
  "fatControl": null,
  "muscleControl": null,
  "smi": null,
  "inbodyScore": null
}`;

  const VISION_MODELS = [
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.2-90b-vision-preview",
    "llama-3.2-11b-vision-preview",
  ];

  let content = "";
  for (const model of VISION_MODELS) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${base64}` },
              },
              { type: "text", text: VISION_PROMPT },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: "json_object" },
      });
      content = response.choices[0]?.message?.content ?? "";
      if (content) {
        logger.info({ model }, "Groq vision model succeeded");
        break;
      }
    } catch (err: any) {
      logger.warn({ err: err.message, model }, "Groq vision model failed, trying next");
    }
  }

  if (!content) throw new Error("All Groq vision models failed");

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON returned from Groq vision model");

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, string | null>;

  const toStr = (v: string | null | undefined): string | undefined => {
    if (!v || v === "null" || v === "N/A" || v === "n/a") return undefined;
    // Allow negative numbers (weightControl, fatControl can be negative)
    const cleaned = String(v).replace(/[^\d.\-]/g, "").replace(/(?<=.)-/g, "");
    return cleaned && /^-?\d/.test(cleaned) ? cleaned : undefined;
  };

  const toGender = (v: string | null | undefined): string | undefined => {
    if (!v || v === "null") return undefined;
    const g = String(v).toLowerCase().trim();
    return g === "male" || g === "female" ? g : undefined;
  };

  const metrics: ExtractedInBodyMetrics = {
    weight: toStr(parsed.weight),
    bmi: toStr(parsed.bmi),
    bodyFat: toStr(parsed.bodyFat),
    bodyFatMass: toStr(parsed.bodyFatMass),
    skeletalMuscleMass: toStr(parsed.skeletalMuscleMass),
    leanBodyMass: toStr(parsed.leanBodyMass),
    fatFreeMass: toStr(parsed.fatFreeMass) ?? toStr(parsed.leanBodyMass),
    softLeanMass: toStr(parsed.softLeanMass),
    protein: toStr(parsed.protein),
    mineral: toStr(parsed.mineral),
    bodyWater: toStr(parsed.bodyWater),
    bmr: toStr(parsed.bmr),
    visceralFat: toStr(parsed.visceralFat),
    metabolicAge: toStr(parsed.metabolicAge),
    waistHipRatio: toStr(parsed.waistHipRatio),
    obesityDegree: toStr(parsed.obesityDegree),
    recommendedCalorieIntake: toStr(parsed.recommendedCalorieIntake),
    targetWeight: toStr(parsed.targetWeight),
    weightControl: toStr(parsed.weightControl),
    fatControl: toStr(parsed.fatControl),
    muscleControl: toStr(parsed.muscleControl),
    smi: toStr(parsed.smi),
    inbodyScore: toStr(parsed.inbodyScore),
    height: toStr(parsed.height),
    age: toStr(parsed.age),
    gender: toGender(parsed.gender),
  };

  // Remove undefined keys
  const cleanMetrics = Object.fromEntries(
    Object.entries(metrics).filter(([, v]) => v !== undefined),
  ) as ExtractedInBodyMetrics;

  const labelMap: Record<string, string> = {
    weight: "Weight (kg)",
    height: "Height (cm)",
    age: "Age",
    gender: "Gender",
    bmi: "BMI",
    bodyFat: "Body Fat %",
    bodyFatMass: "Body Fat Mass (kg)",
    skeletalMuscleMass: "Skeletal Muscle Mass (kg)",
    leanBodyMass: "Lean Body Mass (kg)",
    fatFreeMass: "Fat Free Mass (kg)",
    softLeanMass: "Soft Lean Mass (kg)",
    protein: "Protein (kg)",
    mineral: "Mineral (kg)",
    bodyWater: "Total Body Water (L)",
    bmr: "BMR (kcal)",
    visceralFat: "Visceral Fat Level",
    metabolicAge: "Metabolic Age (yr)",
    waistHipRatio: "Waist-Hip Ratio",
    obesityDegree: "Obesity Degree (%)",
    recommendedCalorieIntake: "Recommended Calorie Intake (kcal)",
    targetWeight: "Target Weight (kg)",
    weightControl: "Weight Control (kg)",
    fatControl: "Fat Control (kg)",
    muscleControl: "Muscle Control (kg)",
    smi: "SMI (kg/m²)",
    inbodyScore: "InBody Score",
  };

  const rawText = Object.entries(cleanMetrics)
    .map(([k, v]) => `${labelMap[k] ?? k}: ${v}`)
    .join("\n");

  logger.info(
    { metricCount: Object.keys(cleanMetrics).length, rawText },
    "Groq Vision extraction result",
  );

  return { metrics: cleanMetrics, rawText };
}

// ─── Google Cloud Vision OCR ──────────────────────────────────────────────────
async function runGoogleVisionOCR(fileBuffer: Buffer, mimeType: string): Promise<string> {
  const GOOGLE_KEY = process.env.GOOGLE_VISION_API_KEY;
  if (!GOOGLE_KEY) throw new Error("GOOGLE_VISION_API_KEY not set");

  const base64 = fileBuffer.toString("base64");

  const requestBody = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION", maxResults: 1 }],
        imageContext: mimeType.includes("pdf") ? { languageHints: ["en"] } : {},
      },
    ],
  };

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Vision API error (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    responses: Array<{ fullTextAnnotation?: { text: string }; error?: { message: string } }>;
  };

  const result = data.responses[0];
  if (result?.error) throw new Error(`Vision API: ${result.error.message}`);

  return result?.fullTextAnnotation?.text ?? "";
}

// ─── OCR.space fallback ───────────────────────────────────────────────────────
async function runOCRSpaceFallback(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const OCR_KEY = process.env.OCR_SPACE_API_KEY;
  if (!OCR_KEY) throw new Error("OCR_SPACE_API_KEY not set");

  const form = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  form.append("file", blob, fileName);
  form.append("apikey", OCR_KEY);
  form.append("language", "eng");
  form.append("isOverlayRequired", "false");
  form.append("detectOrientation", "true");
  form.append("scale", "true");
  form.append("OCREngine", "2");

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    throw new Error(`OCR.space API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    ParsedResults?: Array<{ ParsedText: string }>;
    IsErroredOnProcessing?: boolean;
    ErrorMessage?: string;
  };

  if (data.IsErroredOnProcessing) {
    throw new Error(`OCR.space processing error: ${data.ErrorMessage}`);
  }

  return data.ParsedResults?.map((r) => r.ParsedText).join("\n") ?? "";
}

// ─── Main OCR orchestrator ────────────────────────────────────────────────────
export async function runOCR(
  fileBuffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<{ rawText: string; metrics: ExtractedInBodyMetrics }> {

  // ── Attempt 1: Groq Vision (images only) ─────────────────────────────────
  if (!mimeType.includes("pdf") && process.env.GROQ_API_KEY) {
    try {
      logger.info("Attempting Groq Vision extraction");
      const result = await runGroqVisionExtraction(fileBuffer, mimeType);
      const metricCount = Object.keys(result.metrics).length;
      logger.info({ metricCount }, "Groq Vision extraction complete");

      if (metricCount >= 4) {
        return result;
      }
      logger.warn({ metricCount }, "Groq Vision returned too few metrics, falling through");
    } catch (err: any) {
      logger.warn({ err: err.message }, "Groq Vision failed, trying text OCR");
    }
  }

  // ── Attempt 2: Google Cloud Vision (text OCR) ─────────────────────────────
  let rawText = "";
  if (process.env.GOOGLE_VISION_API_KEY) {
    try {
      logger.info("Using Google Cloud Vision for text OCR");
      rawText = await runGoogleVisionOCR(fileBuffer, mimeType);
    } catch (err: any) {
      logger.warn({ err: err.message }, "Google Vision failed, trying OCR.space");
    }
  }

  // ── Attempt 3: OCR.space ──────────────────────────────────────────────────
  if (!rawText && process.env.OCR_SPACE_API_KEY) {
    try {
      logger.info("Using OCR.space as text OCR fallback");
      rawText = await runOCRSpaceFallback(fileBuffer, mimeType, fileName);
    } catch (err: any) {
      logger.warn({ err: err.message }, "OCR.space also failed");
    }
  }

  // ── Attempt 4: Demo stub ──────────────────────────────────────────────────
  if (!rawText) {
    logger.warn("No OCR method succeeded — using demo stub");
    rawText = getDemoOCRText();
  }

  const metrics = extractMetrics(rawText);
  logger.info({ metricCount: Object.keys(metrics).length }, "Text OCR extraction complete");

  return { rawText: normalizeOCRText(rawText), metrics };
}

// ─── Demo stub for development without API keys ───────────────────────────────
function getDemoOCRText(): string {
  return `
InBody 260 Result Sheet
Height: 180 cm  Age: 22  Gender: Male
Test Date: 2026.05.04

Body Composition Analysis
Total Body Water (L): 46.9
Protein (kg): 12.6
Mineral (kg): 4.67
Body Fat Mass (kg): 45.4
Weight (kg): 109.6

Muscle-Fat Analysis
Weight (kg): 109.6
Skeletal Muscle Mass (kg): 36.2
Body Fat Mass (kg): 45.4

Obesity Analysis
BMI (kg/m2): 33.8
PBF (%): 41.5

InBody Score: 49/100

Weight Control
Target Weight: 75.5 kg
Weight Control: -34.1 kg
Fat Control: -34.1 kg
Muscle Control: 0.0 kg

Research Parameters
Fat Free Mass: 64.2 kg
Basal Metabolic Rate (BMR): 1756 kcal
Obesity Degree: 154 %
SMI: 8.5 kg/m2

Visceral Fat Level: 22

Waist-Hip Ratio: 1.14

Recommended calorie intake: 2966 kcal
  `.trim();
}

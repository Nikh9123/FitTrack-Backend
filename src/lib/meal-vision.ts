import Groq from "groq-sdk";
import { logger } from "./logger";

export interface MealVisionItem {
  name: string;
  servingDescription: string;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: number;
}

export interface MealVisionResult {
  items: MealVisionItem[];
  notes: string;
  source: "groq" | "unavailable";
}

const VISION_MODELS = [
  "llama-4-scout",
  "llama-3.2-90b-vision-preview",
  "llama-3.2-11b-vision-preview",
];

const MEAL_VISION_PROMPT = `You are a nutrition expert specializing in Indian and global cuisine. Analyze this meal photo and estimate nutrition for visible food items.

Rules:
- Identify each distinct food item you can see
- Estimate calories, protein (g), carbs (g), fat (g) for a typical serving shown
- Prefer realistic Indian portion sizes when applicable
- confidence is 0-100 for how sure you are about that item
- If unsure, still provide your best estimate with lower confidence
- Return ONLY valid JSON, no markdown

{
  "items": [
    {
      "name": "Food name with portion e.g. Masala Dosa (1 plate)",
      "servingDescription": "1 plate",
      "caloriesKcal": 350,
      "proteinG": 8,
      "carbsG": 52,
      "fatG": 12,
      "confidence": 75
    }
  ],
  "notes": "Brief note about assumptions or portion size"
}`;

function clampNum(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function normalizeItem(raw: Record<string, unknown>): MealVisionItem | null {
  const name = String(raw.name ?? "").trim();
  if (!name) return null;

  return {
    name,
    servingDescription: String(raw.servingDescription ?? "1 serving").trim() || "1 serving",
    caloriesKcal: Math.round(clampNum(raw.caloriesKcal)),
    proteinG: Math.round(clampNum(raw.proteinG) * 10) / 10,
    carbsG: Math.round(clampNum(raw.carbsG) * 10) / 10,
    fatG: Math.round(clampNum(raw.fatG) * 10) / 10,
    confidence: Math.min(100, Math.max(0, Math.round(clampNum(raw.confidence, 60)))),
  };
}

export async function analyzeMealPhoto(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<MealVisionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      notes: "AI meal analysis requires GROQ_API_KEY on the server.",
      source: "unavailable",
    };
  }

  if (mimeType.includes("pdf")) {
    throw new Error("PDF is not supported for meal photos");
  }

  const groq = new Groq({ apiKey });
  const base64 = fileBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  let content: string | null = null;

  for (const model of VISION_MODELS) {
    try {
      const response = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: MEAL_VISION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      content = response.choices[0]?.message?.content ?? null;
      if (content) {
        logger.info({ model }, "Meal vision model succeeded");
        break;
      }
    } catch (err: any) {
      logger.warn({ err: err.message, model }, "Meal vision model failed, trying next");
    }
  }

  if (!content) {
    throw new Error("Could not analyze meal photo. Try a clearer image.");
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return structured nutrition data");
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    items?: Array<Record<string, unknown>>;
    notes?: string;
  };

  const items = (parsed.items ?? [])
    .map((item) => normalizeItem(item))
    .filter((item): item is MealVisionItem => item != null);

  if (items.length === 0) {
    throw new Error("No food items detected in the photo");
  }

  return {
    items,
    notes: String(parsed.notes ?? "AI-estimated nutrition based on visible portion."),
    source: "groq",
  };
}

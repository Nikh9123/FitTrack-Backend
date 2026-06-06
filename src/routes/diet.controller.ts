import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import { analyzeMealPhoto } from "../lib/meal-vision";
import { logger } from "../lib/logger";
import {
  activateDietPlan,
  assignProfessionalDietPlan,
  generateAndSaveAiDietPlan,
  getActiveDietPlan,
  getDietPlanById,
  listUserDietPlans,
} from "../services/dietPlanService";
import {
  deleteDietLog,
  getDailyDietSummary,
  getDailyWaterSummary,
  getNutritionGoals,
  getNutritionHistory,
  logMeal,
  logWater,
  ML_PER_GLASS,
  searchFoods,
  type MealTime,
} from "../services/dietService";

const MEAL_TIMES = new Set<MealTime>([
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "pre_workout",
  "post_workout",
]);

function todayDateKey() {
  return new Date().toISOString().split("T")[0];
}

export async function searchFoodItems(req: AuthenticatedRequest, res: Response) {
  try {
    const q = String(req.query.q ?? "");
    const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);
    const items = await searchFoods(q, limit);
    return res.json({
      items: items.map((f) => ({
        id: f.id,
        name: f.name,
        category: f.category,
        servingDescription: f.servingDescription,
        calories: parseFloat(String(f.caloriesKcal ?? 0)),
        protein: parseFloat(String(f.proteinG ?? 0)),
        carbs: parseFloat(String(f.carbsG ?? 0)),
        fat: parseFloat(String(f.fatG ?? 0)),
      })),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "searchFoodItems failed");
    return res.status(500).json({ error: "Failed to search foods" });
  }
}

export async function getDietSummary(req: AuthenticatedRequest, res: Response) {
  try {
    const date = String(req.query.date ?? todayDateKey());
    const summary = await getDailyDietSummary(req.auth!.sub, date);
    return res.json(summary);
  } catch (err: any) {
    logger.error({ err: err.message }, "getDietSummary failed");
    return res.status(500).json({ error: "Failed to fetch diet summary" });
  }
}

export async function getDietHistory(req: AuthenticatedRequest, res: Response) {
  try {
    const days = Math.min(parseInt(String(req.query.days ?? "7"), 10) || 7, 365);
    const history = await getNutritionHistory(req.auth!.sub, days);
    return res.json({ history });
  } catch (err: any) {
    logger.error({ err: err.message }, "getDietHistory failed");
    return res.status(500).json({ error: "Failed to fetch diet history" });
  }
}

export async function createDietLog(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { logDate, mealTime, foodItemId, customFood, quantity, notes, servings } = req.body ?? {};

  if (!mealTime || !MEAL_TIMES.has(mealTime)) {
    return res.status(400).json({ error: "Valid mealTime is required" });
  }

  try {
    const log = await logMeal(userId, {
      logDate: logDate ?? todayDateKey(),
      mealTime,
      foodItemId,
      customFood,
      quantity,
      notes,
      servings: servings != null ? Number(servings) : undefined,
    });
    const summary = await getDailyDietSummary(userId, logDate ?? todayDateKey());
    return res.status(201).json({ success: true, log, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "createDietLog failed");
    return res.status(400).json({ error: err.message || "Failed to log meal" });
  }
}

export async function removeDietLog(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const id = String(req.params.id);
  const date = String(req.query.date ?? todayDateKey());

  try {
    await deleteDietLog(userId, id);
    const summary = await getDailyDietSummary(userId, date);
    return res.json({ success: true, summary });
  } catch (err: any) {
    return res.status(404).json({ error: err.message || "Failed to delete log" });
  }
}

export async function getHydrationSummary(req: AuthenticatedRequest, res: Response) {
  try {
    const date = String(req.query.date ?? todayDateKey());
    const summary = await getDailyWaterSummary(req.auth!.sub, date);
    return res.json(summary);
  } catch (err: any) {
    logger.error({ err: err.message }, "getHydrationSummary failed");
    return res.status(500).json({ error: "Failed to fetch water summary" });
  }
}

export async function createWaterLog(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { logDate, amountMl, glasses } = req.body ?? {};

  const ml =
    typeof amountMl === "number"
      ? amountMl
      : typeof glasses === "number"
        ? Math.round(glasses * ML_PER_GLASS)
        : ML_PER_GLASS;

  try {
    const log = await logWater(userId, { logDate: logDate ?? todayDateKey(), amountMl: ml });
    const summary = await getDailyWaterSummary(userId, logDate ?? todayDateKey());
    return res.status(201).json({ success: true, log, summary });
  } catch (err: any) {
    logger.error({ err: err.message }, "createWaterLog failed");
    return res.status(400).json({ error: err.message || "Failed to log water" });
  }
}

export async function getGoals(req: AuthenticatedRequest, res: Response) {
  try {
    const goals = await getNutritionGoals(req.auth!.sub);
    return res.json(goals);
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch goals" });
  }
}

const MEAL_PHOTO_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
]);

export async function analyzeMealPhotoHandler(req: AuthenticatedRequest, res: Response) {
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!file) {
    return res.status(400).json({
      error: "No photo uploaded. Send multipart/form-data with field name 'photo'.",
    });
  }

  if (!MEAL_PHOTO_MIMES.has(file.mimetype)) {
    return res.status(415).json({
      error: `Unsupported file type: ${file.mimetype}. Use JPG, PNG, or WebP.`,
    });
  }

  try {
    const result = await analyzeMealPhoto(file.buffer, file.mimetype);

    if (result.source === "unavailable") {
      return res.status(503).json({
        error: result.notes,
        items: [],
        notes: result.notes,
        source: result.source,
      });
    }

    return res.json({
      items: result.items,
      notes: result.notes,
      source: result.source,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "analyzeMealPhoto failed");
    return res.status(400).json({ error: err.message || "Failed to analyze meal photo" });
  }
}

const DIET_GOALS = new Set(["weight_loss", "maintenance", "muscle_gain", "fat_loss"]);
const DIET_DURATIONS = new Set(["daily", "weekly"]);
const DIET_REGIONS = new Set([
  "south_indian",
  "north_indian",
  "west_indian",
  "east_indian",
  "pan_indian",
]);

export async function listDietPlans(req: AuthenticatedRequest, res: Response) {
  try {
    const plans = await listUserDietPlans(req.auth!.sub);
    return res.json({ plans });
  } catch (err: any) {
    logger.error({ err: err.message }, "listDietPlans failed");
    return res.status(500).json({ error: "Failed to list diet plans" });
  }
}

export async function getActivePlan(req: AuthenticatedRequest, res: Response) {
  try {
    const plan = await getActiveDietPlan(req.auth!.sub);
    return res.json({ plan });
  } catch (err: any) {
    logger.error({ err: err.message }, "getActivePlan failed");
    return res.status(500).json({ error: "Failed to fetch active diet plan" });
  }
}

export async function getDietPlan(req: AuthenticatedRequest, res: Response) {
  try {
    const plan = await getDietPlanById(String(req.params.id), req.auth!.sub);
    return res.json({ plan });
  } catch (err: any) {
    return res.status(404).json({ error: err.message || "Plan not found" });
  }
}

export async function generateAiPlan(req: AuthenticatedRequest, res: Response) {
  const { goal, duration, region, notes, activate } = req.body ?? {};

  if (goal && !DIET_GOALS.has(goal)) {
    return res.status(400).json({ error: "Invalid goal" });
  }
  if (duration && !DIET_DURATIONS.has(duration)) {
    return res.status(400).json({ error: "Invalid duration — use daily or weekly" });
  }
  if (region && !DIET_REGIONS.has(region)) {
    return res.status(400).json({ error: "Invalid region" });
  }

  try {
    const plan = await generateAndSaveAiDietPlan(req.auth!.sub, {
      goal,
      duration,
      region,
      notes,
      activate: activate !== false,
    });
    return res.status(201).json({ success: true, plan });
  } catch (err: any) {
    logger.error({ err: err.message }, "generateAiPlan failed");
    return res.status(500).json({ error: err.message || "Failed to generate diet plan" });
  }
}

export async function assignDietPlan(req: AuthenticatedRequest, res: Response) {
  const assignerId = req.auth!.sub;
  const assignerRole = req.auth!.role;
  const body = req.body ?? {};

  const {
    userId,
    title,
    goal,
    summary,
    professionalNotes,
    source,
    dailyTargets,
    meals,
    tips,
    activate,
  } = body;

  if (!title || !goal || !dailyTargets || !Array.isArray(meals)) {
    return res.status(400).json({
      error: "title, goal, dailyTargets, and meals are required",
    });
  }

  if (!DIET_GOALS.has(goal)) {
    return res.status(400).json({ error: "Invalid goal" });
  }

  const targetUserId = userId ?? assignerId;

  try {
    const plan = await assignProfessionalDietPlan(assignerId, assignerRole, {
      userId: targetUserId,
      title,
      goal,
      summary,
      professionalNotes,
      source: source === "doctor" ? "doctor" : "trainer",
      dailyTargets,
      meals,
      tips,
      activate: activate !== false,
    });
    return res.status(201).json({ success: true, plan });
  } catch (err: any) {
    logger.error({ err: err.message }, "assignDietPlan failed");
    return res.status(err.message.includes("Only trainers") ? 403 : 400).json({
      error: err.message || "Failed to assign diet plan",
    });
  }
}

export async function activatePlan(req: AuthenticatedRequest, res: Response) {
  try {
    const plan = await activateDietPlan(String(req.params.id), req.auth!.sub);
    return res.json({ success: true, plan });
  } catch (err: any) {
    return res.status(404).json({ error: err.message || "Failed to activate plan" });
  }
}

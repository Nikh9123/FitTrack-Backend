import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";
import { db, dietLogs, foodItems, nutritionTargets, waterLogs } from "../db";
export type MealTime = "breakfast" | "lunch" | "dinner" | "snack" | "pre_workout" | "post_workout";

const ML_PER_GLASS = 250;

function dayBounds(dateInput: string) {
  const dayStart = new Date(dateInput);
  if (Number.isNaN(dayStart.getTime())) {
    throw new Error("Invalid date");
  }
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  return { dayStart, dayEnd };
}

export async function searchFoods(query: string, limit = 20) {
  const q = query.trim();
  const catalogFilter = eq(foodItems.source, "fittrack_catalog");

  if (!q) {
    return db
      .select()
      .from(foodItems)
      .where(catalogFilter)
      .orderBy(foodItems.name)
      .limit(limit);
  }

  return db
    .select()
    .from(foodItems)
    .where(and(catalogFilter, ilike(foodItems.name, `%${q}%`)))
    .orderBy(foodItems.name)
    .limit(limit);
}

export async function findOrCreateCustomFood(input: {
  name: string;
  caloriesKcal: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
}) {
  const [existing] = await db
    .select()
    .from(foodItems)
    .where(and(eq(foodItems.name, input.name), eq(foodItems.source, "user_custom")))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(foodItems)
    .values({
      name: input.name,
      category: "custom",
      servingDescription: "1 serving",
      caloriesKcal: String(input.caloriesKcal),
      proteinG: String(input.proteinG ?? 0),
      carbsG: String(input.carbsG ?? 0),
      fatG: String(input.fatG ?? 0),
      source: "user_custom",
      locale: "en_IN",
      isVerified: false,
    })
    .returning();

  return created;
}

export async function logMeal(
  userId: string,
  input: {
    logDate: string;
    mealTime: MealTime;
    foodItemId?: string;
    customFood?: {
      name: string;
      caloriesKcal: number;
      proteinG?: number;
      carbsG?: number;
      fatG?: number;
    };
    quantity?: string;
    servings?: number;
    notes?: string;
  },
) {
  const { dayStart } = dayBounds(input.logDate);

  let foodItemId = input.foodItemId;
  let caloriesKcal = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  const servings = Math.max(1, Math.min(20, Math.floor(input.servings ?? 1)));

  if (foodItemId) {
    const [food] = await db.select().from(foodItems).where(eq(foodItems.id, foodItemId)).limit(1);
    if (!food) throw new Error("Food item not found");
    caloriesKcal = parseFloat(String(food.caloriesKcal ?? 0)) * servings;
    proteinG = parseFloat(String(food.proteinG ?? 0)) * servings;
    carbsG = parseFloat(String(food.carbsG ?? 0)) * servings;
    fatG = parseFloat(String(food.fatG ?? 0)) * servings;
  } else if (input.customFood) {
    const food = await findOrCreateCustomFood(input.customFood);
    foodItemId = food.id;
    caloriesKcal = input.customFood.caloriesKcal * servings;
    proteinG = (input.customFood.proteinG ?? 0) * servings;
    carbsG = (input.customFood.carbsG ?? 0) * servings;
    fatG = (input.customFood.fatG ?? 0) * servings;
  } else {
    throw new Error("foodItemId or customFood required");
  }

  const [log] = await db
    .insert(dietLogs)
    .values({
      userId,
      logDate: dayStart,
      mealTime: input.mealTime,
      foodItemId,
      quantity: input.quantity ?? "1 serving",
      caloriesKcal: String(caloriesKcal),
      proteinG: String(proteinG),
      carbsG: String(carbsG),
      fatG: String(fatG),
      notes: input.notes ?? null,
    })
    .returning();

  return log;
}

export async function deleteDietLog(userId: string, logId: string) {
  const [deleted] = await db
    .delete(dietLogs)
    .where(and(eq(dietLogs.id, logId), eq(dietLogs.userId, userId)))
    .returning();
  if (!deleted) throw new Error("Log not found");
  return deleted;
}

export async function getDailyDietSummary(userId: string, date: string) {
  const { dayStart, dayEnd } = dayBounds(date);

  const logs = await db
    .select({
      id: dietLogs.id,
      mealTime: dietLogs.mealTime,
      quantity: dietLogs.quantity,
      caloriesKcal: dietLogs.caloriesKcal,
      proteinG: dietLogs.proteinG,
      carbsG: dietLogs.carbsG,
      fatG: dietLogs.fatG,
      loggedAt: dietLogs.loggedAt,
      notes: dietLogs.notes,
      foodName: foodItems.name,
      foodItemId: dietLogs.foodItemId,
    })
    .from(dietLogs)
    .innerJoin(foodItems, eq(dietLogs.foodItemId, foodItems.id))
    .where(and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, dayStart), lte(dietLogs.logDate, dayEnd)))
    .orderBy(desc(dietLogs.loggedAt));

  const totals = logs.reduce(
    (acc, row) => ({
      calories: acc.calories + parseFloat(String(row.caloriesKcal ?? 0)),
      protein: acc.protein + parseFloat(String(row.proteinG ?? 0)),
      carbs: acc.carbs + parseFloat(String(row.carbsG ?? 0)),
      fat: acc.fat + parseFloat(String(row.fatG ?? 0)),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const target = await getNutritionTarget(userId);

  return {
    date,
    logs: logs.map((row) => ({
      id: row.id,
      mealTime: row.mealTime,
      name: row.foodName,
      foodItemId: row.foodItemId,
      quantity: row.quantity,
      calories: parseFloat(String(row.caloriesKcal ?? 0)),
      protein: parseFloat(String(row.proteinG ?? 0)),
      carbs: parseFloat(String(row.carbsG ?? 0)),
      fat: parseFloat(String(row.fatG ?? 0)),
      loggedAt: row.loggedAt,
      notes: row.notes,
    })),
    totals,
    calorieGoal: target.dailyCalories,
    proteinGoalG: target.proteinG,
    carbsGoalG: target.carbsG,
    fatGoalG: target.fatG,
  };
}

export async function getNutritionHistory(userId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  since.setHours(0, 0, 0, 0);

  const rows = await db
    .select({
      logDate: dietLogs.logDate,
      caloriesKcal: dietLogs.caloriesKcal,
    })
    .from(dietLogs)
    .where(and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, since)));

  const byDate = new Map<string, number>();
  for (const row of rows) {
    const key = new Date(row.logDate).toISOString().split("T")[0];
    byDate.set(key, (byDate.get(key) ?? 0) + parseFloat(String(row.caloriesKcal ?? 0)));
  }

  const result: Array<{ date: string; calories: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    result.push({ date: key, calories: byDate.get(key) ?? 0 });
  }
  return result;
}

async function getNutritionTarget(userId: string) {
  const [target] = await db
    .select()
    .from(nutritionTargets)
    .where(eq(nutritionTargets.userId, userId))
    .orderBy(desc(nutritionTargets.updatedAt))
    .limit(1);

  return {
    dailyCalories: target?.dailyCalories ?? 2200,
    proteinG: target?.proteinG ? parseFloat(String(target.proteinG)) : 160,
    carbsG: target?.carbsG ? parseFloat(String(target.carbsG)) : 220,
    fatG: target?.fatG ? parseFloat(String(target.fatG)) : 70,
    waterGoalMl: 2000,
    waterGoalGlasses: 8,
  };
}

export async function getNutritionGoals(userId: string) {
  return getNutritionTarget(userId);
}

export async function logWater(userId: string, input: { logDate: string; amountMl: number }) {
  const { dayStart } = dayBounds(input.logDate);
  const amountMl = Math.max(0, Math.floor(input.amountMl));

  const [log] = await db
    .insert(waterLogs)
    .values({
      userId,
      logDate: dayStart,
      amountMl,
    })
    .returning();

  return log;
}

export async function getDailyWaterSummary(userId: string, date: string) {
  const { dayStart, dayEnd } = dayBounds(date);
  const goals = await getNutritionTarget(userId);

  const logs = await db
    .select()
    .from(waterLogs)
    .where(and(eq(waterLogs.userId, userId), gte(waterLogs.logDate, dayStart), lte(waterLogs.logDate, dayEnd)))
    .orderBy(desc(waterLogs.loggedAt));

  const totalMl = logs.reduce((sum, row) => sum + row.amountMl, 0);

  return {
    date,
    totalMl,
    glasses: Math.round(totalMl / ML_PER_GLASS),
    goalMl: goals.waterGoalMl,
    goalGlasses: goals.waterGoalGlasses,
    logs: logs.map((l) => ({
      id: l.id,
      amountMl: l.amountMl,
      loggedAt: l.loggedAt,
    })),
  };
}

export { ML_PER_GLASS };

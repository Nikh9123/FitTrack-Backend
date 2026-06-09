import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import {
  db,
  dietPlanItems,
  dietPlanMeals,
  dietPlans,
  foodItems,
  gyms,
  nutritionTargets,
  userProfiles,
  users,
} from "../db";
import {
  generateAiDietPlan,
  mapGoalInput,
  type AiDietPlanDraft,
  type AiDietPlanMeal,
  type AiDietPlanMealItem,
  type DietPlanDuration,
  type DietPlanGoal,
  type DietRegion,
} from "../lib/diet-plan-ai";
import { findOrCreateCustomFood } from "./dietService";
import { logger } from "../lib/logger";
import { buildPersonalizationMeta, buildUserDietContext } from "../lib/diet-plan-context";

const MEAL_ORDER: Record<string, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
  pre_workout: 4,
  post_workout: 5,
};

const PROFESSIONAL_ROLES = new Set(["trainer", "owner", "staff", "admin"]);

export interface DietPlanMealItemView {
  id: string;
  foodItemId: string;
  foodName: string;
  quantity: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  notes: string | null;
}

export interface DietPlanMealView {
  id: string;
  mealTime: string;
  name: string | null;
  notes: string | null;
  orderIndex: number;
  dayName?: string | null;
  dayIndex?: number | null;
  items: DietPlanMealItemView[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
}

export interface DietPlanDaySection {
  dayName: string;
  dayIndex: number;
  meals: DietPlanMealView[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
}

export interface DietPlanPersonalization {
  usedInbody: boolean;
  usedWeightLogs: boolean;
  usedNutritionLogs: boolean;
  usedActivity: boolean;
  currentWeightKg: number | null;
  weightTrendKg30d: number | null;
  bodyFatPercent: string | null;
  bmr: string | null;
  avgDailyCalories7d: number | null;
  avgSteps7d: number | null;
}

export interface DietPlanView {
  id: string;
  title: string;
  goal: string;
  status: string;
  source: "ai" | "trainer" | "doctor";
  duration: DietPlanDuration;
  region: DietRegion | null;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  summary: string | null;
  tips: string[];
  personalization: DietPlanPersonalization | null;
  assignedBy: string | null;
  assignerName: string | null;
  dailyTargets: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  meals: DietPlanMealView[];
  daySections: DietPlanDaySection[];
  totals: { calories: number; protein: number; carbs: number; fat: number };
  createdAt: string;
}

function parsePlanMeta(notes: string | null): {
  summary?: string;
  tips?: string[];
  source?: string;
  professionalNotes?: string | null;
  duration?: DietPlanDuration;
  region?: DietRegion;
  personalization?: DietPlanPersonalization;
} {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return { summary: notes };
  }
  return {};
}

async function ensureDefaultGymId(): Promise<string> {
  const slug = "fittrack-app";
  const [existing] = await db.select({ id: gyms.id }).from(gyms).where(eq(gyms.slug, slug)).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(gyms)
    .values({ name: "Veera", slug, status: "active" })
    .returning({ id: gyms.id });

  logger.info({ gymId: created.id }, "Created default Veera gym");
  return created.id;
}

async function resolveFoodItemId(item: AiDietPlanMealItem): Promise<string> {
  const name = item.foodName.trim();
  const [exact] = await db
    .select({ id: foodItems.id })
    .from(foodItems)
    .where(and(eq(foodItems.source, "fittrack_catalog"), ilike(foodItems.name, name)))
    .limit(1);
  if (exact) return exact.id;

  const baseName = name.split("(")[0]?.trim() ?? name;
  const [partial] = await db
    .select({ id: foodItems.id })
    .from(foodItems)
    .where(and(eq(foodItems.source, "fittrack_catalog"), ilike(foodItems.name, `%${baseName}%`)))
    .limit(1);
  if (partial) return partial.id;

  const custom = await findOrCreateCustomFood({
    name,
    caloriesKcal: item.caloriesKcal,
    proteinG: item.proteinG,
    carbsG: item.carbsG,
    fatG: item.fatG,
  });
  return custom.id;
}

function encodeMealDayNotes(dayName: string, dayIndex: number, mealNotes?: string | null) {
  return JSON.stringify({
    day: dayName,
    dayIndex,
    ...(mealNotes ? { mealNotes } : {}),
  });
}

function parseMealDayNotes(notes: string | null): {
  dayName?: string;
  dayIndex?: number;
  mealNotes?: string;
} {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    if (parsed && typeof parsed === "object" && parsed.day) {
      return {
        dayName: String(parsed.day),
        dayIndex: typeof parsed.dayIndex === "number" ? parsed.dayIndex : undefined,
        mealNotes: parsed.mealNotes ? String(parsed.mealNotes) : undefined,
      };
    }
  } catch {
    return { mealNotes: notes };
  }
  return { mealNotes: notes };
}

function flattenDraftMeals(draft: AiDietPlanDraft): Array<AiDietPlanMeal & { dayName?: string; dayIndex?: number }> {
  if (draft.duration === "weekly" && draft.days?.length) {
    return draft.days.flatMap((day) =>
      day.meals.map((meal) => ({
        ...meal,
        dayName: day.dayName,
        dayIndex: day.dayIndex,
      })),
    );
  }
  return draft.meals.map((meal) => ({ ...meal }));
}

async function upsertNutritionTargets(
  userId: string,
  gymId: string,
  targets: AiDietPlanDraft["dailyTargets"],
) {
  await db.insert(nutritionTargets).values({
    userId,
    gymId,
    startDate: new Date(),
    dailyCalories: targets.calories,
    proteinG: String(targets.proteinG),
    carbsG: String(targets.carbsG),
    fatG: String(targets.fatG),
  });
}

async function pauseActivePlans(userId: string) {
  await db
    .update(dietPlans)
    .set({ status: "paused", updatedAt: new Date() })
    .where(and(eq(dietPlans.userId, userId), eq(dietPlans.status, "active")));
}

async function persistDietPlanDraft(
  userId: string,
  draft: AiDietPlanDraft,
  options: {
    assignedBy?: string | null;
    source: "ai" | "trainer" | "doctor";
    activate?: boolean;
    professionalNotes?: string;
    personalization?: DietPlanPersonalization | null;
  },
): Promise<string> {
  const gymId = await ensureDefaultGymId();

  if (options.activate) {
    await pauseActivePlans(userId);
  }

  const meta = {
    source: options.source,
    summary: draft.summary,
    tips: draft.tips,
    professionalNotes: options.professionalNotes ?? null,
    duration: draft.duration ?? "daily",
    region: draft.region ?? null,
    personalization: options.personalization ?? null,
  };

  const startDate = new Date();
  const endDate =
    draft.duration === "weekly"
      ? new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000)
      : null;

  const [plan] = await db
    .insert(dietPlans)
    .values({
      gymId,
      userId,
      assignedBy: options.assignedBy ?? null,
      title: draft.title,
      goal: draft.goal as DietPlanGoal,
      status: options.activate ? "active" : "draft",
      startDate,
      endDate,
      notes: JSON.stringify(meta),
    })
    .returning({ id: dietPlans.id });

  const mealsToPersist = flattenDraftMeals(draft);

  for (let i = 0; i < mealsToPersist.length; i++) {
    const meal = mealsToPersist[i];
    const dayIndex = meal.dayIndex ?? 0;
    const orderIndex = dayIndex * 10 + (MEAL_ORDER[meal.mealTime] ?? 99);
    const [mealRow] = await db
      .insert(dietPlanMeals)
      .values({
        dietPlanId: plan.id,
        mealTime: meal.mealTime,
        name: meal.name,
        notes:
          meal.dayName != null
            ? encodeMealDayNotes(meal.dayName, dayIndex, meal.notes ?? null)
            : meal.notes ?? null,
        orderIndex,
      })
      .returning({ id: dietPlanMeals.id });

    for (const item of meal.items) {
      const foodItemId = await resolveFoodItemId(item);
      await db.insert(dietPlanItems).values({
        mealId: mealRow.id,
        foodItemId,
        quantity: item.quantity,
        notes: null,
      });
    }
  }

  await upsertNutritionTargets(userId, gymId, draft.dailyTargets);
  return plan.id;
}

export async function getUserDietContext(userId: string) {
  return buildUserDietContext(userId);
}

export async function generateAndSaveAiDietPlan(
  userId: string,
  input?: {
    goal?: DietPlanGoal;
    duration?: DietPlanDuration;
    region?: DietRegion;
    notes?: string;
    activate?: boolean;
  },
) {
  const context = await buildUserDietContext(userId);
  const personalization = buildPersonalizationMeta(context);
  const draft = await generateAiDietPlan(context, {
    goal: input?.goal,
    duration: input?.duration,
    region: input?.region,
    notes: input?.notes,
  });

  const planId = await persistDietPlanDraft(userId, draft, {
    source: "ai",
    assignedBy: null,
    activate: input?.activate ?? true,
    personalization,
  });

  return getDietPlanById(planId, userId);
}

export async function assignProfessionalDietPlan(
  assignerId: string,
  assignerRole: string,
  input: {
    userId: string;
    title: string;
    goal: DietPlanGoal;
    summary?: string;
    professionalNotes?: string;
    source?: "trainer" | "doctor";
    dailyTargets: AiDietPlanDraft["dailyTargets"];
    meals: AiDietPlanDraft["meals"];
    tips?: string[];
    activate?: boolean;
  },
) {
  if (!PROFESSIONAL_ROLES.has(assignerRole)) {
    throw new Error("Only trainers, staff, or admins can assign diet plans");
  }

  const draft: AiDietPlanDraft = {
    title: input.title,
    goal: input.goal,
    duration: "daily",
    region: "pan_indian",
    summary: input.summary ?? "Personalized plan from your fitness professional.",
    dailyTargets: input.dailyTargets,
    meals: input.meals,
    tips: input.tips ?? [],
  };

  const planId = await persistDietPlanDraft(input.userId, draft, {
    assignedBy: assignerId,
    source: input.source ?? "trainer",
    activate: input.activate ?? true,
    professionalNotes: input.professionalNotes,
  });

  return getDietPlanById(planId, input.userId);
}

export async function listUserDietPlans(userId: string) {
  const rows = await db
    .select({
      id: dietPlans.id,
      title: dietPlans.title,
      goal: dietPlans.goal,
      status: dietPlans.status,
      notes: dietPlans.notes,
      assignedBy: dietPlans.assignedBy,
      startDate: dietPlans.startDate,
      createdAt: dietPlans.createdAt,
    })
    .from(dietPlans)
    .where(eq(dietPlans.userId, userId))
    .orderBy(desc(dietPlans.createdAt));

  const assignerIds = [...new Set(rows.map((r) => r.assignedBy).filter(Boolean))] as string[];
  const assignerMap = new Map<string, string>();

  if (assignerIds.length > 0) {
    const assigners = await db
      .select({ id: users.id, firstName: userProfiles.firstName, lastName: userProfiles.lastName })
      .from(users)
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(inArray(users.id, assignerIds));

    for (const a of assigners) {
      assignerMap.set(a.id, [a.firstName, a.lastName].filter(Boolean).join(" ") || "Professional");
    }
  }

  return rows.map((row) => {
    const meta = parsePlanMeta(row.notes);
    const source = row.assignedBy
      ? (meta.source === "doctor" ? "doctor" : "trainer")
      : "ai";

    return {
      id: row.id,
      title: row.title,
      goal: row.goal,
      status: row.status,
      source,
      summary: meta.summary ?? null,
      assignedBy: row.assignedBy,
      assignerName: row.assignedBy ? assignerMap.get(row.assignedBy) ?? null : null,
      startDate: row.startDate.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  });
}

async function buildPlanView(
  plan: typeof dietPlans.$inferSelect,
  assignerName: string | null,
): Promise<DietPlanView> {
  const meta = parsePlanMeta(plan.notes);
  const source = plan.assignedBy
    ? (meta.source === "doctor" ? "doctor" : "trainer")
    : "ai";

  const meals = await db
    .select({
      id: dietPlanMeals.id,
      mealTime: dietPlanMeals.mealTime,
      name: dietPlanMeals.name,
      notes: dietPlanMeals.notes,
      orderIndex: dietPlanMeals.orderIndex,
    })
    .from(dietPlanMeals)
    .where(eq(dietPlanMeals.dietPlanId, plan.id))
    .orderBy(dietPlanMeals.orderIndex);

  const mealViews: DietPlanMealView[] = [];

  for (const meal of meals) {
    const items = await db
      .select({
        id: dietPlanItems.id,
        foodItemId: dietPlanItems.foodItemId,
        quantity: dietPlanItems.quantity,
        notes: dietPlanItems.notes,
        foodName: foodItems.name,
        caloriesKcal: foodItems.caloriesKcal,
        proteinG: foodItems.proteinG,
        carbsG: foodItems.carbsG,
        fatG: foodItems.fatG,
      })
      .from(dietPlanItems)
      .innerJoin(foodItems, eq(dietPlanItems.foodItemId, foodItems.id))
      .where(eq(dietPlanItems.mealId, meal.id));

    const itemViews: DietPlanMealItemView[] = items.map((item) => ({
      id: item.id,
      foodItemId: item.foodItemId,
      foodName: item.foodName,
      quantity: item.quantity,
      calories: parseFloat(String(item.caloriesKcal ?? 0)),
      protein: parseFloat(String(item.proteinG ?? 0)),
      carbs: parseFloat(String(item.carbsG ?? 0)),
      fat: parseFloat(String(item.fatG ?? 0)),
      notes: item.notes,
    }));

    const totals = itemViews.reduce(
      (acc, item) => ({
        calories: acc.calories + item.calories,
        protein: acc.protein + item.protein,
        carbs: acc.carbs + item.carbs,
        fat: acc.fat + item.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );

    const dayMeta = parseMealDayNotes(meal.notes);

    mealViews.push({
      id: meal.id,
      mealTime: meal.mealTime,
      name: meal.name,
      notes: dayMeta.mealNotes ?? (dayMeta.dayName ? null : meal.notes),
      orderIndex: meal.orderIndex,
      dayName: dayMeta.dayName ?? null,
      dayIndex: dayMeta.dayIndex ?? null,
      items: itemViews,
      totals,
    });
  }

  const dayMap = new Map<number, DietPlanDaySection>();
  for (const meal of mealViews) {
    const dayIndex = meal.dayIndex ?? 0;
    const dayName = meal.dayName ?? "Day 1";
    if (!dayMap.has(dayIndex)) {
      dayMap.set(dayIndex, {
        dayName,
        dayIndex,
        meals: [],
        totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      });
    }
    const section = dayMap.get(dayIndex)!;
    section.meals.push(meal);
    section.totals.calories += meal.totals.calories;
    section.totals.protein += meal.totals.protein;
    section.totals.carbs += meal.totals.carbs;
    section.totals.fat += meal.totals.fat;
  }

  const daySections = [...dayMap.values()].sort((a, b) => a.dayIndex - b.dayIndex);
  const isWeekly = meta.duration === "weekly" || daySections.length > 1;

  const planTotals = mealViews.reduce(
    (acc, meal) => ({
      calories: acc.calories + meal.totals.calories,
      protein: acc.protein + meal.totals.protein,
      carbs: acc.carbs + meal.totals.carbs,
      fat: acc.fat + meal.totals.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const [target] = await db
    .select()
    .from(nutritionTargets)
    .where(eq(nutritionTargets.userId, plan.userId))
    .orderBy(desc(nutritionTargets.updatedAt))
    .limit(1);

  return {
    id: plan.id,
    title: plan.title,
    goal: plan.goal,
    status: plan.status,
    source,
    duration: isWeekly ? "weekly" : (meta.duration ?? "daily"),
    region: meta.region ?? null,
    startDate: plan.startDate.toISOString(),
    endDate: plan.endDate?.toISOString() ?? null,
    notes: meta.professionalNotes ?? null,
    summary: meta.summary ?? null,
    tips: meta.tips ?? [],
    personalization: meta.personalization ?? null,
    assignedBy: plan.assignedBy,
    assignerName,
    dailyTargets: {
      calories: target?.dailyCalories ?? Math.round(planTotals.calories / Math.max(daySections.length, 1)),
      proteinG: target?.proteinG ? parseFloat(String(target.proteinG)) : planTotals.protein / Math.max(daySections.length, 1),
      carbsG: target?.carbsG ? parseFloat(String(target.carbsG)) : planTotals.carbs / Math.max(daySections.length, 1),
      fatG: target?.fatG ? parseFloat(String(target.fatG)) : planTotals.fat / Math.max(daySections.length, 1),
    },
    meals: mealViews,
    daySections,
    totals: planTotals,
    createdAt: plan.createdAt.toISOString(),
  };
}

export async function getDietPlanById(planId: string, userId: string) {
  const [plan] = await db
    .select()
    .from(dietPlans)
    .where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId)))
    .limit(1);

  if (!plan) throw new Error("Diet plan not found");

  let assignerName: string | null = null;
  if (plan.assignedBy) {
    const [assigner] = await db
      .select({ firstName: userProfiles.firstName, lastName: userProfiles.lastName })
      .from(userProfiles)
      .where(eq(userProfiles.userId, plan.assignedBy))
      .limit(1);
    assignerName = [assigner?.firstName, assigner?.lastName].filter(Boolean).join(" ") || "Professional";
  }

  return buildPlanView(plan, assignerName);
}

export async function getActiveDietPlan(userId: string) {
  const [plan] = await db
    .select()
    .from(dietPlans)
    .where(and(eq(dietPlans.userId, userId), eq(dietPlans.status, "active")))
    .orderBy(desc(dietPlans.updatedAt))
    .limit(1);

  if (!plan) return null;
  return getDietPlanById(plan.id, userId);
}

export async function activateDietPlan(planId: string, userId: string) {
  const [plan] = await db
    .select()
    .from(dietPlans)
    .where(and(eq(dietPlans.id, planId), eq(dietPlans.userId, userId)))
    .limit(1);

  if (!plan) throw new Error("Diet plan not found");

  await pauseActivePlans(userId);
  await db
    .update(dietPlans)
    .set({ status: "active", updatedAt: new Date() })
    .where(eq(dietPlans.id, planId));

  return getDietPlanById(planId, userId);
}

export { mapGoalInput, PROFESSIONAL_ROLES };

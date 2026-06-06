import Groq from "groq-sdk";
import { logger } from "./logger";

export type DietPlanGoal = "weight_loss" | "maintenance" | "muscle_gain" | "fat_loss";
export type DietPlanDuration = "daily" | "weekly";
export type DietRegion =
  | "south_indian"
  | "north_indian"
  | "west_indian"
  | "east_indian"
  | "pan_indian";

export interface AiDietPlanMealItem {
  foodName: string;
  quantity: string;
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface AiDietPlanMeal {
  mealTime: "breakfast" | "lunch" | "dinner" | "snack";
  name: string;
  notes?: string;
  items: AiDietPlanMealItem[];
}

export interface AiDietPlanDay {
  dayName: string;
  dayIndex: number;
  meals: AiDietPlanMeal[];
}

export interface AiDietPlanDraft {
  title: string;
  goal: DietPlanGoal;
  duration: DietPlanDuration;
  region: DietRegion;
  summary: string;
  dailyTargets: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
  meals: AiDietPlanMeal[];
  days?: AiDietPlanDay[];
  tips: string[];
}

export interface UserDietContext {
  fitnessGoal?: string | null;
  dietaryPreference?: string | null;
  activityLevel?: string | null;
  weightKg?: string | null;
  heightCm?: string | null;
  gender?: string | null;
  region?: string | null;
  bmi?: string | null;
  bodyFatPercent?: string | null;
  ageYears?: number | null;
  workoutExperience?: string | null;
  inbody?: {
    weight?: string;
    bmi?: string;
    bodyFat?: string;
    skeletalMuscleMass?: string;
    leanBodyMass?: string;
    bmr?: string;
    visceralFat?: string;
    metabolicAge?: string;
    bodyWater?: string;
    reportDate?: string;
    fitnessLevel?: string | null;
    analysisSummary?: string | null;
    metabolismNote?: string | null;
    bodyFatNote?: string | null;
    muscleNote?: string | null;
    recommendations?: string[];
  } | null;
  weightProgress?: {
    currentWeightKg: number | null;
    profileWeightKg: number | null;
    inbodyWeightKg: number | null;
    trendKg30d: number | null;
    recentEntries: Array<{ date: string; weightKg: number }>;
  } | null;
  nutrition?: {
    avgDailyCalories7d: number | null;
    avgDailyProtein7d: number | null;
    avgDailyCarbs7d: number | null;
    avgDailyFat7d: number | null;
    daysLogged7d: number;
    currentCalorieGoal: number | null;
    currentProteinGoalG: number | null;
  } | null;
  activity?: {
    avgSteps7d: number | null;
    avgActiveMinutes7d: number | null;
    avgCaloriesBurned7d: number | null;
    daysTracked7d: number;
  } | null;
}

export interface GenerateDietPlanOptions {
  goal?: DietPlanGoal;
  duration?: DietPlanDuration;
  region?: DietRegion;
  notes?: string;
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const REGION_LABELS: Record<DietRegion, string> = {
  south_indian: "South Indian (Tamil Nadu, Kerala, Karnataka, Andhra)",
  north_indian: "North Indian (Punjab, Delhi, UP, Rajasthan)",
  west_indian: "West Indian (Maharashtra, Gujarat, Goa)",
  east_indian: "East Indian (Bengal, Odisha, Assam)",
  pan_indian: "Pan-Indian (balanced mix of regional cuisines)",
};

const REGION_FOODS: Record<DietRegion, string[]> = {
  south_indian: [
    "Idli (2 pcs)", "Masala Dosa (1 pc)", "Sambar (1 bowl)", "Rasam (1 bowl)", "Upma (1 plate)",
    "Pongal (1 bowl)", "Curd Rice (1 bowl)", "Appam (2 pcs)", "Filter Coffee (1 cup)",
  ],
  north_indian: [
    "Aloo Paratha (1 pc)", "Chole (1 bowl)", "Rajma (1 bowl)", "Dal Makhani (1 bowl)",
    "Chapati / Roti (1 pc)", "Paneer Butter Masala (1 cup)", "Lassi (1 glass)", "Poha (1 plate)",
  ],
  west_indian: [
    "Poha (1 plate)", "Dhokla (4 pcs)", "Misal Pav (1 plate)", "Thepla (2 pcs)",
    "Vada Pav (1 pc)", "Sabudana Khichdi (1 plate)", "Pav Bhaji (1 plate)",
  ],
  east_indian: [
    "Luchi (2 pcs)", "Aloo Dum (1 cup)", "Fish Curry (100g)", "Khichdi (1 bowl)",
    "Mishti Doi (1 cup)", "Cholar Dal (1 bowl)", "Basmati Rice (1 cup cooked)",
  ],
  pan_indian: [
    "Idli (2 pcs)", "Poha (1 plate)", "Chapati / Roti (1 pc)", "Dal Tadka (1 bowl)",
    "Basmati Rice (1 cup cooked)", "Paneer Butter Masala (1 cup)", "Grilled Chicken Breast (100g)",
    "Sprouts Salad (1 bowl)", "Buttermilk Chaas (1 glass)", "Banana (1 medium)",
  ],
};

function parseNum(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function activityMultiplier(level?: string | null): number {
  const l = (level ?? "").toLowerCase();
  if (l.includes("very") || l.includes("extra")) return 1.725;
  if (l.includes("active") && !l.includes("inactive")) return 1.55;
  if (l.includes("moderate")) return 1.45;
  if (l.includes("light")) return 1.375;
  if (l.includes("sedentary")) return 1.2;
  return 1.45;
}

/** Estimate daily targets from InBody BMR, weight, activity, and goal. */
export function estimateDailyTargets(
  context: UserDietContext,
  goal: DietPlanGoal,
): AiDietPlanDraft["dailyTargets"] {
  const weight =
    context.weightProgress?.currentWeightKg ??
    parseNum(context.inbody?.weight) ??
    parseNum(context.weightKg) ??
    70;
  const heightCm = parseNum(context.heightCm) ?? 170;
  const age = context.ageYears ?? 30;
  const gender = (context.gender ?? "").toLowerCase();

  let bmr = parseNum(context.inbody?.bmr);
  if (bmr == null) {
    // Mifflin-St Jeor
    bmr =
      gender.startsWith("f") || gender === "female"
        ? 10 * weight + 6.25 * heightCm - 5 * age - 161
        : 10 * weight + 6.25 * heightCm - 5 * age + 5;
  }

  let multiplier = activityMultiplier(context.activityLevel);
  if ((context.activity?.avgSteps7d ?? 0) >= 10000) multiplier += 0.08;
  else if ((context.activity?.avgSteps7d ?? 0) >= 7500) multiplier += 0.04;
  if ((context.activity?.avgActiveMinutes7d ?? 0) >= 45) multiplier += 0.05;

  let tdee = bmr * multiplier;

  // Adjust for recent weight trend
  const trend = context.weightProgress?.trendKg30d;
  if (trend != null && trend > 1 && (goal === "fat_loss" || goal === "weight_loss")) {
    tdee -= 100;
  }

  let calories: number;
  switch (goal) {
    case "muscle_gain":
      calories = Math.round(tdee + 300);
      break;
    case "weight_loss":
      calories = Math.round(tdee - 500);
      break;
    case "fat_loss":
      calories = Math.round(tdee - 400);
      break;
    default:
      calories = Math.round(tdee);
  }

  calories = Math.max(1400, Math.min(3500, calories));

  const bodyFat = parseNum(context.bodyFatPercent ?? context.inbody?.bodyFat);
  let proteinG: number;
  if (goal === "muscle_gain") proteinG = Math.round(weight * 2.0);
  else if (goal === "fat_loss" || goal === "weight_loss") proteinG = Math.round(weight * 1.8);
  else proteinG = Math.round(weight * 1.6);

  if (bodyFat != null && bodyFat > 28 && goal !== "muscle_gain") {
    proteinG = Math.round(weight * 2.0);
  }

  const proteinCal = proteinG * 4;
  const fatG = Math.round((calories * 0.28) / 9);
  const fatCal = fatG * 9;
  const carbsG = Math.max(80, Math.round((calories - proteinCal - fatCal) / 4));

  return { calories, proteinG, carbsG, fatG };
}

function formatMetricsBlock(context: UserDietContext, goal: DietPlanGoal): string {
  const lines: string[] = [
    "=== BODY & PROFILE ===",
    `- Fitness goal: ${context.fitnessGoal ?? goal}`,
    `- Diet preference: ${context.dietaryPreference ?? "no restriction"}`,
    `- Activity level: ${context.activityLevel ?? "moderate"}`,
    `- Gender: ${context.gender ?? "unknown"}`,
    `- Age: ${context.ageYears ?? "unknown"}`,
    `- Height cm: ${context.heightCm ?? "unknown"}`,
    `- Current weight kg: ${context.weightKg ?? "unknown"}`,
    `- BMI: ${context.bmi ?? context.inbody?.bmi ?? "unknown"}`,
    `- Body fat %: ${context.bodyFatPercent ?? context.inbody?.bodyFat ?? "unknown"}`,
    `- Workout experience: ${context.workoutExperience ?? "unknown"}`,
  ];

  if (context.inbody) {
    lines.push(
      "",
      "=== LATEST INBODY SCAN ===",
      `- Report date: ${context.inbody.reportDate ?? "unknown"}`,
      `- Weight: ${context.inbody.weight ?? "unknown"} kg`,
      `- Body fat: ${context.inbody.bodyFat ?? "unknown"}%`,
      `- Skeletal muscle mass: ${context.inbody.skeletalMuscleMass ?? "unknown"} kg`,
      `- Lean body mass: ${context.inbody.leanBodyMass ?? "unknown"} kg`,
      `- BMR: ${context.inbody.bmr ?? "unknown"} kcal`,
      `- Visceral fat level: ${context.inbody.visceralFat ?? "unknown"}`,
      `- Metabolic age: ${context.inbody.metabolicAge ?? "unknown"}`,
      `- Fitness level: ${context.inbody.fitnessLevel ?? "unknown"}`,
    );
    if (context.inbody.analysisSummary) {
      lines.push(`- AI analysis summary: ${context.inbody.analysisSummary}`);
    }
    if (context.inbody.bodyFatNote) lines.push(`- Body fat advice: ${context.inbody.bodyFatNote}`);
    if (context.inbody.muscleNote) lines.push(`- Muscle advice: ${context.inbody.muscleNote}`);
    if (context.inbody.metabolismNote) lines.push(`- Metabolism note: ${context.inbody.metabolismNote}`);
    if (context.inbody.recommendations?.length) {
      lines.push(`- Key recommendations: ${context.inbody.recommendations.join("; ")}`);
    }
  }

  if (context.weightProgress && context.weightProgress.recentEntries.length > 0) {
    lines.push(
      "",
      "=== WEIGHT PROGRESS (last 30 days) ===",
      `- 30-day trend: ${context.weightProgress.trendKg30d != null ? `${context.weightProgress.trendKg30d > 0 ? "+" : ""}${context.weightProgress.trendKg30d} kg` : "insufficient data"}`,
      `- Recent weigh-ins: ${context.weightProgress.recentEntries.map((e) => `${e.date}: ${e.weightKg}kg`).join(", ")}`,
    );
  }

  if (context.nutrition && context.nutrition.daysLogged7d > 0) {
    lines.push(
      "",
      "=== RECENT NUTRITION LOGS (7 days) ===",
      `- Days logged: ${context.nutrition.daysLogged7d}/7`,
      `- Avg daily calories: ${context.nutrition.avgDailyCalories7d ?? "unknown"} kcal`,
      `- Avg daily protein: ${context.nutrition.avgDailyProtein7d ?? "unknown"}g`,
      `- Avg daily carbs: ${context.nutrition.avgDailyCarbs7d ?? "unknown"}g`,
      `- Avg daily fat: ${context.nutrition.avgDailyFat7d ?? "unknown"}g`,
      `- Previous calorie goal: ${context.nutrition.currentCalorieGoal ?? "none set"}`,
    );
  }

  if (context.activity && context.activity.daysTracked7d > 0) {
    lines.push(
      "",
      "=== ACTIVITY (7 days) ===",
      `- Avg daily steps: ${context.activity.avgSteps7d ?? 0}`,
      `- Avg active minutes: ${context.activity.avgActiveMinutes7d ?? 0}`,
      `- Avg calories burned: ${context.activity.avgCaloriesBurned7d ?? 0}`,
    );
  }

  const suggested = estimateDailyTargets(context, goal);
  lines.push(
    "",
    "=== CALCULATED DAILY TARGETS (use as baseline, adjust portions to match) ===",
    `- Calories: ${suggested.calories} kcal`,
    `- Protein: ${suggested.proteinG}g`,
    `- Carbs: ${suggested.carbsG}g`,
    `- Fat: ${suggested.fatG}g`,
  );

  return lines.join("\n");
}

function mapGoalInput(goal?: string | null): DietPlanGoal {
  const g = (goal ?? "").toLowerCase();
  if (g.includes("muscle") || g.includes("gain") || g.includes("strength")) return "muscle_gain";
  if (g.includes("maintain")) return "maintenance";
  if (g.includes("fat")) return "fat_loss";
  if (g.includes("loss") || g.includes("cut")) return "weight_loss";
  return "fat_loss";
}

function normalizeRegion(region?: string | null): DietRegion {
  const r = (region ?? "").toLowerCase().replace(/\s+/g, "_");
  if (r.includes("south")) return "south_indian";
  if (r.includes("north")) return "north_indian";
  if (r.includes("west")) return "west_indian";
  if (r.includes("east")) return "east_indian";
  if (r.includes("pan")) return "pan_indian";
  return "pan_indian";
}

function buildDailyMeals(goal: DietPlanGoal, region: DietRegion, dayOffset = 0): AiDietPlanMeal[] {
  const isMuscle = goal === "muscle_gain";
  const isLoss = goal === "fat_loss" || goal === "weight_loss";
  const foods = REGION_FOODS[region];

  const breakfastPool: Record<DietRegion, AiDietPlanMealItem[][]> = {
    south_indian: [
      [{ foodName: "Idli (2 pcs)", quantity: "2 pieces", caloriesKcal: 140, proteinG: 4, carbsG: 28, fatG: 0.5 }, { foodName: "Sambar (1 bowl)", quantity: "1 bowl", caloriesKcal: 100, proteinG: 5, carbsG: 15, fatG: 2 }],
      [{ foodName: "Masala Dosa (1 pc)", quantity: "1 piece", caloriesKcal: 250, proteinG: 6, carbsG: 38, fatG: 8 }, { foodName: "Filter Coffee (1 cup)", quantity: "1 cup", caloriesKcal: 30, proteinG: 1, carbsG: 4, fatG: 1 }],
      [{ foodName: "Upma (1 plate)", quantity: "1 plate", caloriesKcal: 220, proteinG: 5, carbsG: 32, fatG: 8 }],
    ],
    north_indian: [
      [{ foodName: "Aloo Paratha (1 pc)", quantity: "1 piece", caloriesKcal: 280, proteinG: 6, carbsG: 38, fatG: 12 }],
      [{ foodName: "Poha (1 plate)", quantity: "1 plate", caloriesKcal: 250, proteinG: 5, carbsG: 42, fatG: 6 }],
      [{ foodName: "Chapati / Roti (1 pc)", quantity: "2 pieces", caloriesKcal: 140, proteinG: 6, carbsG: 30, fatG: 1 }, { foodName: "Boiled Eggs (2 pcs)", quantity: "2 eggs", caloriesKcal: 140, proteinG: 12, carbsG: 1, fatG: 10 }],
    ],
    west_indian: [
      [{ foodName: "Poha (1 plate)", quantity: "1 plate", caloriesKcal: 250, proteinG: 5, carbsG: 42, fatG: 6 }],
      [{ foodName: "Dhokla (4 pcs)", quantity: "4 pieces", caloriesKcal: 160, proteinG: 6, carbsG: 28, fatG: 3 }],
      [{ foodName: "Thepla (2 pcs)", quantity: "2 pieces", caloriesKcal: 200, proteinG: 5, carbsG: 28, fatG: 7 }],
    ],
    east_indian: [
      [{ foodName: "Luchi (2 pcs)", quantity: "2 pieces", caloriesKcal: 260, proteinG: 4, carbsG: 34, fatG: 12 }],
      [{ foodName: "Khichdi (1 bowl)", quantity: "1 bowl", caloriesKcal: 220, proteinG: 7, carbsG: 38, fatG: 4 }],
      [{ foodName: "Poha (1 plate)", quantity: "1 plate", caloriesKcal: 250, proteinG: 5, carbsG: 42, fatG: 6 }],
    ],
    pan_indian: [
      [{ foodName: foods[0] ?? "Idli (2 pcs)", quantity: "1 serving", caloriesKcal: 140, proteinG: 4, carbsG: 28, fatG: 0.5 }],
      [{ foodName: "Poha (1 plate)", quantity: "1 plate", caloriesKcal: 250, proteinG: 5, carbsG: 42, fatG: 6 }],
      [{ foodName: "Boiled Eggs (2 pcs)", quantity: "2 eggs", caloriesKcal: 140, proteinG: 12, carbsG: 1, fatG: 10 }],
    ],
  };

  const lunchItems = isMuscle
    ? [
        { foodName: "Basmati Rice (1 cup cooked)", quantity: "1 cup", caloriesKcal: 200, proteinG: 4, carbsG: 44, fatG: 0 },
        { foodName: "Dal Tadka (1 bowl)", quantity: "1 bowl", caloriesKcal: 170, proteinG: 9, carbsG: 24, fatG: 5 },
        { foodName: "Grilled Chicken Breast (100g)", quantity: "100g", caloriesKcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
      ]
    : [
        { foodName: "Chapati / Roti (1 pc)", quantity: "2 pieces", caloriesKcal: 140, proteinG: 6, carbsG: 30, fatG: 1 },
        { foodName: region === "south_indian" ? "Sambar (1 bowl)" : "Dal Tadka (1 bowl)", quantity: "1 bowl", caloriesKcal: 170, proteinG: 9, carbsG: 24, fatG: 5 },
        { foodName: "Sprouts Salad (1 bowl)", quantity: "1 bowl", caloriesKcal: 120, proteinG: 8, carbsG: 18, fatG: 2 },
      ];

  const breakfastItems = breakfastPool[region][dayOffset % breakfastPool[region].length];

  return [
    { mealTime: "breakfast", name: "Morning meal", items: breakfastItems },
    { mealTime: "lunch", name: "Main meal", items: lunchItems },
    {
      mealTime: "snack",
      name: "Evening snack",
      items: [
        { foodName: "Buttermilk Chaas (1 glass)", quantity: "1 glass", caloriesKcal: 50, proteinG: 3, carbsG: 6, fatG: 1 },
        { foodName: "Banana (1 medium)", quantity: "1 medium", caloriesKcal: 90, proteinG: 1, carbsG: 23, fatG: 0 },
      ],
    },
    {
      mealTime: "dinner",
      name: "Light dinner",
      items: isMuscle
        ? [
            { foodName: "Paneer Butter Masala (1 cup)", quantity: "1 cup", caloriesKcal: 380, proteinG: 16, carbsG: 18, fatG: 28 },
            { foodName: "Chapati / Roti (1 pc)", quantity: "2 pieces", caloriesKcal: 140, proteinG: 6, carbsG: 30, fatG: 1 },
          ]
        : region === "south_indian"
          ? [
              { foodName: "Curd Rice (1 bowl)", quantity: "1 bowl", caloriesKcal: 260, proteinG: 8, carbsG: 42, fatG: 6 },
              { foodName: "Rasam (1 bowl)", quantity: "1 bowl", caloriesKcal: 60, proteinG: 2, carbsG: 10, fatG: 1 },
            ]
          : [
              { foodName: "Curd Rice (1 bowl)", quantity: "1 bowl", caloriesKcal: 260, proteinG: 8, carbsG: 42, fatG: 6 },
              { foodName: "Boiled Eggs (2 pcs)", quantity: "2 eggs", caloriesKcal: 140, proteinG: 12, carbsG: 1, fatG: 10 },
            ],
    },
  ];
}

function defaultPlan(
  context: UserDietContext,
  options?: GenerateDietPlanOptions,
): AiDietPlanDraft {
  const goal = options?.goal ?? mapGoalInput(context.fitnessGoal);
  const duration = options?.duration ?? "daily";
  const region = options?.region ?? normalizeRegion(context.region);
  const isMuscle = goal === "muscle_gain";
  const isLoss = goal === "fat_loss" || goal === "weight_loss";

  const targets = estimateDailyTargets(context, goal);
  const { calories, proteinG, carbsG, fatG } = targets;

  const regionLabel = REGION_LABELS[region].split("(")[0].trim();
  const durationLabel = duration === "weekly" ? "7-Day" : "Daily";
  const goalLabel = isMuscle ? "Muscle Gain" : isLoss ? "Fat Loss" : "Balanced";

  const days: AiDietPlanDay[] =
    duration === "weekly"
      ? WEEKDAY_NAMES.map((dayName, dayIndex) => ({
          dayName,
          dayIndex,
          meals: buildDailyMeals(goal, region, dayIndex),
        }))
      : [];

  const meals = duration === "weekly" ? days[0]?.meals ?? buildDailyMeals(goal, region) : buildDailyMeals(goal, region);

  const personalizedNote = context.inbody
    ? ` Calibrated using your InBody scan${context.weightProgress?.trendKg30d != null ? ` and ${context.weightProgress.trendKg30d > 0 ? "recent weight gain" : "recent weight loss"} trend` : ""}.`
    : context.weightProgress?.recentEntries.length
      ? " Calibrated using your recent weight logs."
      : "";

  return {
    title: `${durationLabel} ${regionLabel} ${goalLabel} Plan`,
    goal,
    duration,
    region,
    summary:
      (duration === "weekly"
        ? `A personalized 7-day ${regionLabel.toLowerCase()} meal plan for ${goal.replace("_", " ")} using authentic regional home foods with variety across the week.`
        : `A balanced full-day ${regionLabel.toLowerCase()} meal plan tailored to your goal using common regional home foods.`) +
      personalizedNote,
    dailyTargets: { calories, proteinG, carbsG, fatG },
    tips: [
      "Drink 8+ glasses of water daily",
      `Prefer ${regionLabel.toLowerCase()} whole grains and lean protein`,
      context.inbody
        ? "Targets calibrated from your latest InBody scan and body composition"
        : duration === "weekly"
          ? "Follow the day-wise schedule; repeat weekly for consistency"
          : "Adjust portions based on hunger and weekly progress",
    ],
    meals,
    days: duration === "weekly" ? days : undefined,
  };
}

function normalizeDraft(
  parsed: Partial<AiDietPlanDraft>,
  context: UserDietContext,
  options: GenerateDietPlanOptions,
): AiDietPlanDraft {
  const fallback = defaultPlan(context, options);
  const goal = mapGoalInput(parsed.goal ?? options.goal ?? context.fitnessGoal);
  const duration: DietPlanDuration =
    parsed.duration === "weekly" || options.duration === "weekly" ? "weekly" : "daily";
  const region = normalizeRegion(parsed.region ?? options.region ?? context.region);

  if (duration === "weekly" && Array.isArray(parsed.days) && parsed.days.length >= 5) {
    const days = parsed.days.slice(0, 7).map((day, i) => ({
      dayName: day.dayName ?? WEEKDAY_NAMES[i] ?? `Day ${i + 1}`,
      dayIndex: day.dayIndex ?? i,
      meals: Array.isArray(day.meals) ? day.meals : fallback.days?.[i]?.meals ?? fallback.meals,
    }));

    return {
      title: parsed.title ?? fallback.title,
      goal,
      duration,
      region,
      summary: parsed.summary ?? fallback.summary,
      dailyTargets: parsed.dailyTargets ?? fallback.dailyTargets,
      tips: parsed.tips ?? fallback.tips,
      meals: days[0]?.meals ?? fallback.meals,
      days,
    };
  }

  const meals = Array.isArray(parsed.meals) && parsed.meals.length > 0 ? parsed.meals : fallback.meals;
  return {
    title: parsed.title ?? fallback.title,
    goal,
    duration: "daily",
    region,
    summary: parsed.summary ?? fallback.summary,
    dailyTargets: parsed.dailyTargets ?? fallback.dailyTargets,
    tips: parsed.tips ?? fallback.tips,
    meals,
  };
}

export async function generateAiDietPlan(
  context: UserDietContext,
  options?: GenerateDietPlanOptions,
): Promise<AiDietPlanDraft> {
  const goal = options?.goal ?? mapGoalInput(context.fitnessGoal);
  const duration = options?.duration ?? "daily";
  const region = options?.region ?? normalizeRegion(context.region);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return defaultPlan(context, { ...options, goal, duration, region });
  }

  const groq = new Groq({ apiKey });
  const regionLabel = REGION_LABELS[region];
  const catalogFoods = REGION_FOODS[region].join(", ");

  const weeklySchema =
    duration === "weekly"
      ? `"days": [
    {
      "dayName": "Monday",
      "dayIndex": 0,
      "meals": [
        {
          "mealTime": "breakfast|lunch|dinner|snack",
          "name": "meal label",
          "notes": "optional",
          "items": [{ "foodName": "exact food with portion", "quantity": "1 serving", "caloriesKcal": number, "proteinG": number, "carbsG": number, "fatG": number }]
        }
      ]
    }
  ]`
      : `"meals": [
    {
      "mealTime": "breakfast|lunch|dinner|snack",
      "name": "meal label",
      "notes": "optional",
      "items": [{ "foodName": "exact food with portion", "quantity": "1 serving", "caloriesKcal": number, "proteinG": number, "carbsG": number, "fatG": number }]
    }
  ]`;

  const metricsBlock = formatMetricsBlock(context, goal);

  const prompt = `Create a personalized ${duration === "weekly" ? "7-day weekly" : "single-day"} Indian diet plan.

${metricsBlock}

=== PLAN REQUEST ===
- Plan goal enum: ${goal}
- Plan duration: ${duration}
- Cuisine region (MUST follow): ${regionLabel}
- Extra notes: ${options?.notes ?? "none"}

CRITICAL — Personalization rules:
- Set dailyTargets.calories/proteinG/carbsG/fatG close to the CALCULATED DAILY TARGETS above
- If body fat is high or goal is fat loss, favor lean protein and controlled portions
- If muscle mass is low or goal is muscle gain, increase protein-rich ${regionLabel.split("(")[0].trim()} foods
- If user is losing weight (negative trend), maintain moderate deficit; if gaining unintentionally, tighten portions
- If avg logged calories exist, use them to judge current intake vs target
- High visceral fat → reduce fried foods and refined carbs even within regional cuisine

CRITICAL — Regional cuisine rules (every meal MUST use authentic ${regionLabel} foods):
- Use ONLY foods authentic to ${regionLabel}
- South Indian: idli, dosa, sambar, rasam, pongal, appam, curd rice — NOT paratha/chole as staples
- North Indian: paratha, chole, rajma, dal makhani, roti, lassi — NOT idli/dosa as staples
- West Indian: poha, dhokla, thepla, misal, vada pav, sabudana
- East Indian: luchi, fish curry, khichdi, cholar dal, mishti doi
- Pan-Indian: mix regional staples but keep each meal coherent to one regional style
- NEVER suggest Western-only foods (sandwich, pasta, cereal) unless user notes request it

Prefer foods from this ${region} catalog:
${catalogFoods}

Return ONLY valid JSON:
{
  "title": "string including region and duration",
  "goal": "${goal}",
  "duration": "${duration}",
  "region": "${region}",
  "summary": "2-3 sentences about the ${duration} ${region} plan",
  "dailyTargets": { "calories": number, "proteinG": number, "carbsG": number, "fatG": number },
  "tips": ["tip1", "tip2", "tip3"],
  ${weeklySchema}
}

Rules:
- ${duration === "weekly" ? "Include exactly 7 days (Monday through Sunday) with varied meals — no copy-paste same day 7 times" : "Include breakfast, lunch, dinner, and 1 snack"}
- Respect vegetarian preference if stated
- dailyTargets MUST align with calculated targets from user metrics (±10%)
- Use realistic Indian portions from the regional catalog
- dailyTargets should roughly match sum of meal items per day
- Each day must have breakfast, lunch, dinner, and 1 snack
- All foodName values must be recognizable Indian dishes matching the selected region`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.35,
      max_tokens: duration === "weekly" ? 7500 : 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a certified sports nutritionist specializing in ${regionLabel} cuisine. Return ONLY valid JSON.`,
        },
        { role: "user", content: prompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw) as Partial<AiDietPlanDraft>;
    return normalizeDraft(parsed, context, { ...options, goal, duration, region });
  } catch (err: any) {
    logger.warn({ err: err.message }, "AI diet plan generation failed — using default");
    return defaultPlan(context, { ...options, goal, duration, region });
  }
}

export { mapGoalInput, normalizeRegion, REGION_LABELS, WEEKDAY_NAMES };

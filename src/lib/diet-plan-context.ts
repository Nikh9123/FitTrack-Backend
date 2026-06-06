import { and, desc, eq, gte } from "drizzle-orm";
import {
  activitySummaries,
  db,
  dietLogs,
  inbodyReports,
  nutritionTargets,
  userProfiles,
  weightLogs,
} from "../db";
import type { UserDietContext } from "./diet-plan-ai";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseNum(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age > 0 && age < 120 ? age : null;
}

function pickGeminiField(analysis: Record<string, unknown> | null, path: string[]): string | null {
  let cur: unknown = analysis;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" && cur.trim() ? cur.trim() : null;
}

function pickGeminiStringArray(analysis: Record<string, unknown> | null, key: string): string[] {
  const val = analysis?.[key];
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 5);
}

export async function buildUserDietContext(userId: string): Promise<UserDietContext> {
  const since7 = daysAgo(6);
  const since30 = daysAgo(30);

  const [profileRow, inbodyRows, weightRows, dietRows, activityRows, targetRow] = await Promise.all([
    db
      .select({
        fitnessGoal: userProfiles.fitnessGoal,
        dietaryPreference: userProfiles.dietaryPreference,
        activityLevel: userProfiles.activityLevel,
        weightKg: userProfiles.weightKg,
        heightCm: userProfiles.heightCm,
        gender: userProfiles.gender,
        region: userProfiles.region,
        bmi: userProfiles.bmi,
        bodyFatPercent: userProfiles.bodyFatPercent,
        dateOfBirth: userProfiles.dateOfBirth,
        workoutExperience: userProfiles.workoutExperience,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
    db
      .select({
        extractedMetrics: inbodyReports.extractedMetrics,
        geminiAnalysis: inbodyReports.geminiAnalysis,
        createdAt: inbodyReports.createdAt,
      })
      .from(inbodyReports)
      .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1),
    db
      .select({
        weightKg: weightLogs.weightKg,
        recordedAt: weightLogs.recordedAt,
      })
      .from(weightLogs)
      .where(and(eq(weightLogs.userId, userId), gte(weightLogs.recordedAt, since30)))
      .orderBy(desc(weightLogs.recordedAt))
      .limit(20),
    db
      .select({
        logDate: dietLogs.logDate,
        caloriesKcal: dietLogs.caloriesKcal,
        proteinG: dietLogs.proteinG,
        carbsG: dietLogs.carbsG,
        fatG: dietLogs.fatG,
      })
      .from(dietLogs)
      .where(and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, since7))),
    db
      .select({
        steps: activitySummaries.steps,
        walkingMinutes: activitySummaries.walkingMinutes,
        runningMinutes: activitySummaries.runningMinutes,
        caloriesBurned: activitySummaries.caloriesBurned,
        summaryDate: activitySummaries.summaryDate,
      })
      .from(activitySummaries)
      .where(and(eq(activitySummaries.userId, userId), gte(activitySummaries.summaryDate, since7)))
      .orderBy(desc(activitySummaries.summaryDate)),
    db
      .select({
        dailyCalories: nutritionTargets.dailyCalories,
        proteinG: nutritionTargets.proteinG,
        carbsG: nutritionTargets.carbsG,
        fatG: nutritionTargets.fatG,
      })
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.updatedAt))
      .limit(1),
  ]);

  const profile = profileRow[0];
  const inbody = inbodyRows[0];
  const metrics = (inbody?.extractedMetrics ?? {}) as Record<string, string>;
  const gemini = (inbody?.geminiAnalysis ?? null) as Record<string, unknown> | null;

  const profileWeight = parseNum(profile?.weightKg);
  const inbodyWeight = parseNum(metrics.weight);
  const latestLogWeight = weightRows[0] ? parseNum(String(weightRows[0].weightKg)) : null;
  const currentWeightKg = latestLogWeight ?? inbodyWeight ?? profileWeight;

  const weightEntries = weightRows
    .map((r) => ({
      date: r.recordedAt.toISOString().split("T")[0],
      weightKg: parseNum(String(r.weightKg)) ?? 0,
    }))
    .filter((r) => r.weightKg > 0);

  let trendKg30d: number | null = null;
  if (weightEntries.length >= 2) {
    trendKg30d = Math.round((weightEntries[0].weightKg - weightEntries[weightEntries.length - 1].weightKg) * 10) / 10;
  }

  const dietByDate = new Map<string, { calories: number; protein: number; carbs: number; fat: number }>();
  for (const row of dietRows) {
    const key = new Date(row.logDate).toISOString().split("T")[0];
    const prev = dietByDate.get(key) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    dietByDate.set(key, {
      calories: prev.calories + parseFloat(String(row.caloriesKcal ?? 0)),
      protein: prev.protein + parseFloat(String(row.proteinG ?? 0)),
      carbs: prev.carbs + parseFloat(String(row.carbsG ?? 0)),
      fat: prev.fat + parseFloat(String(row.fatG ?? 0)),
    });
  }

  const daysWithLogs = [...dietByDate.values()].filter((d) => d.calories > 0);
  const avgDailyCalories7d =
    daysWithLogs.length > 0
      ? Math.round(daysWithLogs.reduce((s, d) => s + d.calories, 0) / daysWithLogs.length)
      : null;
  const avgDailyProtein7d =
    daysWithLogs.length > 0
      ? Math.round(daysWithLogs.reduce((s, d) => s + d.protein, 0) / daysWithLogs.length)
      : null;
  const avgDailyCarbs7d =
    daysWithLogs.length > 0
      ? Math.round(daysWithLogs.reduce((s, d) => s + d.carbs, 0) / daysWithLogs.length)
      : null;
  const avgDailyFat7d =
    daysWithLogs.length > 0
      ? Math.round(daysWithLogs.reduce((s, d) => s + d.fat, 0) / daysWithLogs.length)
      : null;

  const activityDays = activityRows.length;
  const avgSteps7d =
    activityDays > 0
      ? Math.round(activityRows.reduce((s, r) => s + (r.steps ?? 0), 0) / activityDays)
      : null;
  const avgActiveMinutes7d =
    activityDays > 0
      ? Math.round(
          activityRows.reduce((s, r) => s + (r.walkingMinutes ?? 0) + (r.runningMinutes ?? 0), 0) / activityDays,
        )
      : null;
  const avgCaloriesBurned7d =
    activityDays > 0
      ? Math.round(activityRows.reduce((s, r) => s + (r.caloriesBurned ?? 0), 0) / activityDays)
      : null;

  const bodyFat =
    parseNum(metrics.bodyFat)?.toString() ??
    profile?.bodyFatPercent ??
    null;

  const bmi = metrics.bmi ?? profile?.bmi ?? null;

  const inbodySnapshot =
    inbody && Object.keys(metrics).length > 0
      ? {
          weight: metrics.weight,
          bmi: metrics.bmi,
          bodyFat: metrics.bodyFat,
          skeletalMuscleMass: metrics.skeletalMuscleMass,
          leanBodyMass: metrics.leanBodyMass,
          bmr: metrics.bmr,
          visceralFat: metrics.visceralFat,
          metabolicAge: metrics.metabolicAge,
          bodyWater: metrics.bodyWater,
          reportDate: inbody.createdAt.toISOString().split("T")[0],
          fitnessLevel: pickGeminiField(gemini, ["fitnessLevel"]),
          analysisSummary: pickGeminiField(gemini, ["overallSummary"]),
          metabolismNote: pickGeminiField(gemini, ["metabolismInsights", "description"]),
          bodyFatNote: pickGeminiField(gemini, ["bodyFatAnalysis", "recommendation"]),
          muscleNote: pickGeminiField(gemini, ["muscleMassAnalysis", "recommendation"]),
          recommendations: pickGeminiStringArray(gemini, "recommendations"),
        }
      : null;

  return {
    fitnessGoal: profile?.fitnessGoal ?? null,
    dietaryPreference: profile?.dietaryPreference ?? null,
    activityLevel: profile?.activityLevel ?? null,
    weightKg: currentWeightKg != null ? String(currentWeightKg) : profile?.weightKg ?? null,
    heightCm: profile?.heightCm ?? null,
    gender: profile?.gender ?? null,
    region: profile?.region ?? null,
    bmi,
    bodyFatPercent: bodyFat,
    ageYears: ageFromDob(profile?.dateOfBirth ?? null),
    workoutExperience: profile?.workoutExperience ?? null,
    inbody: inbodySnapshot,
    weightProgress: {
      currentWeightKg,
      profileWeightKg: profileWeight,
      inbodyWeightKg: inbodyWeight,
      trendKg30d,
      recentEntries: weightEntries.slice(0, 8),
    },
    nutrition: {
      avgDailyCalories7d,
      avgDailyProtein7d,
      avgDailyCarbs7d,
      avgDailyFat7d,
      daysLogged7d: daysWithLogs.length,
      currentCalorieGoal: targetRow[0]?.dailyCalories ?? null,
      currentProteinGoalG: targetRow[0]?.proteinG ? parseFloat(String(targetRow[0].proteinG)) : null,
    },
    activity: {
      avgSteps7d,
      avgActiveMinutes7d,
      avgCaloriesBurned7d,
      daysTracked7d: activityDays,
    },
  };
}

export function buildPersonalizationMeta(context: UserDietContext) {
  return {
    usedInbody: Boolean(context.inbody),
    usedWeightLogs: (context.weightProgress?.recentEntries.length ?? 0) > 0,
    usedNutritionLogs: (context.nutrition?.daysLogged7d ?? 0) > 0,
    usedActivity: (context.activity?.daysTracked7d ?? 0) > 0,
    currentWeightKg: context.weightProgress?.currentWeightKg ?? null,
    weightTrendKg30d: context.weightProgress?.trendKg30d ?? null,
    bodyFatPercent: context.bodyFatPercent ?? null,
    bmr: context.inbody?.bmr ?? null,
    avgDailyCalories7d: context.nutrition?.avgDailyCalories7d ?? null,
    avgSteps7d: context.activity?.avgSteps7d ?? null,
  };
}

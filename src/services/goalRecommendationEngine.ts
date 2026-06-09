import { and, desc, eq } from "drizzle-orm";
import { db, goals, nutritionTargets, userProfiles } from "../db";
import type { HistoryDayBucket } from "./historyService";

export type GoalConfidence = "high" | "medium" | "low";

export interface GoalEvaluation {
  type: string;
  target: number | null;
  current: number | null;
  unit: string;
  completionPct: number;
  estimatedWeeks: number | null;
  confidence: GoalConfidence;
  message: string;
}

export interface NextWeekGoals {
  steps: number;
  calories: number;
  proteinG: number;
  workouts: number;
  sleepHours: number;
  waterGlasses: number;
  notes: string[];
}

const ML_PER_GLASS = 250;
const MIN_CAL_FEMALE = 1200;
const MIN_CAL_MALE = 1500;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseWeight(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function loggingConfidence(buckets: HistoryDayBucket[], workoutCompleted: number, plannedWorkouts: number) {
  const mealDays = buckets.filter((b) => b.caloriesConsumed > 0).length;
  const stepDays = buckets.filter((b) => b.steps > 0).length;
  const workoutRatio = plannedWorkouts > 0 ? workoutCompleted / plannedWorkouts : workoutCompleted > 0 ? 1 : 0;

  if (mealDays >= 5 && stepDays >= 5 && workoutRatio >= 0.6) return "high" as const;
  if (mealDays >= 3 || stepDays >= 3 || workoutCompleted >= 2) return "medium" as const;
  return "low" as const;
}

export async function evaluateGoal(params: {
  userId: string;
  buckets: HistoryDayBucket[];
  workoutCompleted: number;
  plannedWorkouts: number;
}): Promise<GoalEvaluation> {
  const { userId, buckets, workoutCompleted, plannedWorkouts } = params;

  const [profileRow, activeGoal, nutrition] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
    db
      .select()
      .from(goals)
      .where(and(eq(goals.userId, userId), eq(goals.status, "active")))
      .orderBy(desc(goals.createdAt))
      .limit(1),
    db
      .select()
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.updatedAt))
      .limit(1),
  ]);

  const profile = profileRow[0];
  const goalRow = activeGoal[0];
  const fitnessGoal = profile?.fitnessGoal ?? "maintain";
  const confidence = loggingConfidence(buckets, workoutCompleted, plannedWorkouts);

  const weightBuckets = buckets.filter((b) => b.weightKg != null);
  const startWeight = weightBuckets[0]?.weightKg ?? parseWeight(profile?.weightKg);
  const endWeight = weightBuckets[weightBuckets.length - 1]?.weightKg ?? startWeight;

  const progressKg =
    startWeight != null && endWeight != null ? Math.round((startWeight - endWeight) * 10) / 10 : 0;

  let goalTypeLabel = goalRow?.goalType ?? fitnessGoal;
  let unit = goalRow?.unit ?? "kg";
  let typeLabel = String(goalTypeLabel);
  let target: number | null = goalRow ? parseFloat(String(goalRow.targetValue)) : null;

  if (!target) {
    if (fitnessGoal === "weight_loss" || fitnessGoal === "fat_loss") target = 5;
    else if (fitnessGoal === "muscle_gain") target = 3;
    else target = null;
  }

  let completionPct = 0;
  if (target && target > 0 && (fitnessGoal === "weight_loss" || fitnessGoal === "fat_loss" || goalTypeLabel === "weight")) {
    completionPct = clamp(Math.round((Math.max(progressKg, 0) / target) * 100), 0, 100);
  } else if (plannedWorkouts > 0) {
    completionPct = clamp(Math.round((workoutCompleted / plannedWorkouts) * 100), 0, 100);
    typeLabel = "workout_consistency";
    unit = "sessions";
    target = plannedWorkouts;
  }

  const weeksElapsed = Math.max(buckets.length / 7, 1);
  const weeklyRate = progressKg / weeksElapsed;
  const estimatedWeeks =
    target && weeklyRate > 0.05 ? Math.ceil(Math.max(target - Math.max(progressKg, 0), 0) / weeklyRate) : null;

  let message = "Keep logging consistently to unlock precise goal tracking.";
  if (confidence === "high" && progressKg > 0.2) {
    message = `You lost ${progressKg} kg this period — ${completionPct}% toward your target.`;
  } else if (workoutCompleted >= plannedWorkouts && plannedWorkouts > 0) {
    message = `You hit ${workoutCompleted}/${plannedWorkouts} planned workouts — excellent consistency.`;
  } else if (confidence === "low") {
    message = "Log meals, steps, and workouts more often for accurate goal evaluation.";
  }

  return {
    type: typeLabel,
    target,
    current: endWeight ?? workoutCompleted,
    unit,
    completionPct,
    estimatedWeeks,
    confidence,
    message,
  };
}

export async function recommendNextWeekGoals(params: {
  userId: string;
  buckets: HistoryDayBucket[];
  workoutCompleted: number;
  plannedWorkouts: number;
  waterGoalMl?: number;
}): Promise<NextWeekGoals> {
  const { userId, buckets, workoutCompleted, plannedWorkouts, waterGoalMl = 2000 } = params;

  const [profileRow, nutrition] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)).limit(1),
    db
      .select()
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.updatedAt))
      .limit(1),
  ]);

  const profile = profileRow[0];
  const fitnessGoal = profile?.fitnessGoal ?? "maintain";
  const gender = profile?.gender ?? "male";
  const weightKg = parseWeight(profile?.weightKg) ?? 70;

  const avgSteps =
    buckets.length > 0 ? Math.round(buckets.reduce((s, b) => s + b.steps, 0) / buckets.length) : 6000;
  const avgSleep =
    buckets.filter((b) => b.sleepHours > 0).length > 0
      ? buckets.filter((b) => b.sleepHours > 0).reduce((s, b) => s + b.sleepHours, 0) /
        buckets.filter((b) => b.sleepHours > 0).length
      : 7;

  const baseCalories = nutrition[0]?.dailyCalories ?? 2200;
  const baseProtein = nutrition[0]?.proteinG ? parseFloat(String(nutrition[0].proteinG)) : 160;

  const notes: string[] = [];
  let steps = avgSteps;
  let calories = baseCalories;
  let proteinG = baseProtein;
  let workouts = Math.max(plannedWorkouts, workoutCompleted, 3);
  let sleepHours = Math.round(avgSleep * 10) / 10;
  let waterGlasses = Math.round(waterGoalMl / ML_PER_GLASS);

  const minCal = gender === "female" ? MIN_CAL_FEMALE : MIN_CAL_MALE;

  if (fitnessGoal === "weight_loss" || fitnessGoal === "fat_loss") {
    steps = Math.round(avgSteps * 1.05);
    calories = clamp(Math.round(baseCalories * 0.9), minCal, baseCalories);
    proteinG = Math.round(weightKg * 1.8);
    sleepHours = Math.max(sleepHours, 7.5);
    waterGlasses = Math.max(waterGlasses, 12);
    notes.push("Aim for a modest calorie deficit while keeping protein high.");
  } else if (fitnessGoal === "muscle_gain") {
    steps = avgSteps;
    calories = baseCalories + 200;
    proteinG = Math.round(weightKg * 2.0);
    sleepHours = Math.max(sleepHours, 8);
    notes.push("Prioritize protein and progressive overload in your sessions.");
  } else {
    proteinG = Math.round(weightKg * 1.6);
    sleepHours = Math.max(sleepHours, 7);
    notes.push("Maintain your current habits with small improvements.");
  }

  const maxSteps = Math.round(avgSteps * 1.1);
  if (steps > maxSteps) {
    steps = maxSteps;
    notes.push("Step target capped at +10% to reduce injury risk.");
  }

  if (workoutCompleted < plannedWorkouts && plannedWorkouts > 0) {
    workouts = plannedWorkouts;
    notes.push(`Try to complete all ${plannedWorkouts} planned sessions next week.`);
  }

  return {
    steps,
    calories,
    proteinG,
    workouts,
    sleepHours,
    waterGlasses,
    notes,
  };
}

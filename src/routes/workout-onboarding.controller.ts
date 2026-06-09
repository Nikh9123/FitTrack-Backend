/**
 * Workout Onboarding Controller
 * ------------------------------
 * Handles AI goal recommendation, workout plan generation,
 * status checks, and saving onboarding results.
 */

import type { Response } from "express";
import { db, inbodyReports, userProfiles } from "../db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import Groq from "groq-sdk";
import type { AuthenticatedRequest } from "../lib/auth";
import type { WorkoutLocation } from "../lib/exercisedb";
import { getWorkoutPlanContext } from "../services/workoutPlanSourceService";
import {
  buildMetricsSnapshot,
  buildStructuredExercisePlan,
} from "../services/workoutPlanBuilderService";
import { saveOnboardingPlanDirectly } from "../services/workoutService";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const FITNESS_GOALS = [
  "Fat Loss",
  "Muscle Gain",
  "Body Recomposition",
  "Strength",
  "Athletic Performance",
  "General Fitness",
] as const;

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type FitnessGoal = typeof FITNESS_GOALS[number];

// ΓöÇΓöÇΓöÇ GET /api/workout/onboarding/status ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export async function getOnboardingStatus(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  try {
    const [profile] = await db
      .select({
        onboardingData: userProfiles.onboardingData,
        fitnessGoal: userProfiles.fitnessGoal,
      })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    if (!profile) {
      return res.json({ completed: false, hasInBodyReport: false });
    }

    const extra = (profile.onboardingData as Record<string, unknown> | null) ?? {};
    const workoutOnboardingCompleted = Boolean(extra.workoutOnboardingCompleted);

    const [latestReport] = await db
      .select({ id: inbodyReports.id, extractedMetrics: inbodyReports.extractedMetrics, geminiAnalysis: inbodyReports.geminiAnalysis })
      .from(inbodyReports)
      .where(eq(inbodyReports.userId, userId))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1);

    const planContext = await getWorkoutPlanContext(userId);

    const metricsConsidered = buildMetricsSnapshot(
      (latestReport?.extractedMetrics as Record<string, string> | null) ?? null,
      Boolean(latestReport),
    );

    return res.json({
      completed: workoutOnboardingCompleted,
      fitnessGoal: profile.fitnessGoal ?? extra.selectedGoal ?? null,
      workoutPlan: extra.generatedWorkoutPlan ?? null,
      hasInBodyReport: Boolean(latestReport),
      latestReportId: latestReport?.id ?? null,
      inBodyMetrics: latestReport?.extractedMetrics ?? null,
      metricsConsidered,
      planSource: planContext.planSource,
      hasTrainerAssigned: planContext.hasTrainerAssigned,
      canGenerateWithAi: planContext.canGenerateWithAi,
      trainerName: planContext.trainerName,
    });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get workout onboarding status");
    return res.status(500).json({ error: "Failed to get onboarding status" });
  }
}

// ΓöÇΓöÇΓöÇ POST /api/workout/onboarding/ai-recommend ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export async function aiRecommendGoal(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  try {
    // Fetch the latest InBody report
    const [report] = await db
      .select()
      .from(inbodyReports)
      .where(eq(inbodyReports.userId, userId))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1);

    if (!report || !report.extractedMetrics) {
      return res.status(404).json({
        success: false,
        noReport: true,
        error: "No InBody report found. Upload your report first for AI recommendations.",
      });
    }

    const metrics = report.extractedMetrics as Record<string, string>;
    const analysis = report.geminiAnalysis as Record<string, unknown> | null;

    if (!groq) {
      return res.json({
        success: true,
        recommendation: buildFallbackRecommendation(metrics),
      });
    }

    const prompt = buildRecommendationPrompt(metrics, analysis);

    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are an elite fitness coach and body composition specialist. Analyze InBody report data and recommend the single best fitness goal for this person. Return ONLY valid JSON with exactly this structure: {"recommendedGoal":"<one of: Fat Loss|Muscle Gain|Body Recomposition|Strength|Athletic Performance|General Fitness>","reasoning":"<2-3 sentences explaining why, using specific metric values>","transformationPriority":"<highest-priority area to address first>","estimatedTimeline":"<realistic timeline to see results>","beginnerSuitability":"<Beginner|Intermediate|Advanced>","confidence":<number 70-99>}`,
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });

    const rawText = completion.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(rawText);

    if (!FITNESS_GOALS.includes(parsed.recommendedGoal)) {
      parsed.recommendedGoal = inferGoalFromMetrics(metrics);
    }

    return res.json({ success: true, recommendation: parsed });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "AI goal recommendation failed");
    const [report] = await db.select().from(inbodyReports).where(eq(inbodyReports.userId, userId)).limit(1).catch(() => [null]);
    const metrics = (report?.extractedMetrics as Record<string, string> | null) ?? {};
    return res.json({
      success: true,
      recommendation: buildFallbackRecommendation(metrics),
    });
  }
}

// ΓöÇΓöÇΓöÇ POST /api/workout/onboarding/generate-plan ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export async function generateWorkoutPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { goal, level = "beginner", preferences, workoutLocation = "gym" } = req.body as {
    goal: FitnessGoal;
    level?: string;
    preferences?: string;
    workoutLocation?: WorkoutLocation;
  };
  const location: WorkoutLocation = workoutLocation === "home" ? "home" : "gym";

  if (!goal || !FITNESS_GOALS.includes(goal)) {
    return res.status(400).json({ error: "Invalid fitness goal" });
  }

  try {
    const planContext = await getWorkoutPlanContext(userId);
    if (planContext.hasTrainerAssigned) {
      return res.status(403).json({
        success: false,
        error: "Your trainer has assigned your workout plan. Contact them for changes.",
        planSource: "trainer",
      });
    }

    // Fetch latest InBody data for personalisation
    const [report] = await db
      .select({ extractedMetrics: inbodyReports.extractedMetrics, geminiAnalysis: inbodyReports.geminiAnalysis })
      .from(inbodyReports)
      .where(eq(inbodyReports.userId, userId))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1);

    const metrics = (report?.extractedMetrics as Record<string, string> | null) ?? {};
    const analysis = (report?.geminiAnalysis as Record<string, unknown> | null) ?? {};

    // Step 1: AI decides the workout strategy (split, frequency, intensity)
    let strategy = await buildWorkoutStrategy(goal, metrics, analysis, level, preferences, location);

    // Step 2: Build structured plan from catalog (warmup ΓåÆ cardio ΓåÆ main ΓåÆ stretch)
    const plan = await buildStructuredExercisePlan(strategy.trainingDays, strategy.sessionDuration);
    const metricsConsidered = buildMetricsSnapshot(metrics, Boolean(report));

    return res.json({
      success: true,
      strategy,
      plan,
      planSource: "ai",
      usedInBody: Boolean(report),
      catalogExercises: true,
      metricsConsidered,
      workoutLocation: location,
    });
  } catch (err: any) {
    logger.error({ err: err.message, userId, goal }, "Workout plan generation failed");
    return res.status(500).json({ error: "Failed to generate workout plan. Please try again." });
  }
}

// ΓöÇΓöÇΓöÇ POST /api/workout/onboarding/save ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export async function saveOnboarding(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { goal, aiRecommendedGoal, workoutPlan, strategy, workoutLocation } = req.body as {
    goal: string;
    aiRecommendedGoal?: string;
    workoutPlan?: unknown;
    strategy?: unknown;
    workoutLocation?: WorkoutLocation;
  };

  if (!goal) {
    return res.status(400).json({ error: "goal is required" });
  }

  try {
    const planContext = await getWorkoutPlanContext(userId);
    if (planContext.hasTrainerAssigned) {
      return res.status(403).json({
        success: false,
        error: "Cannot overwrite a trainer-assigned plan with AI. Contact your trainer.",
      });
    }

    const [existingProfile] = await db
      .select({ onboardingData: userProfiles.onboardingData })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const existingExtra = (existingProfile?.onboardingData as Record<string, unknown> | null) ?? {};

    const updatedExtra = {
      ...existingExtra,
      workoutOnboardingCompleted: true,
      selectedGoal: goal,
      aiRecommendedGoal: aiRecommendedGoal ?? null,
      workoutStrategy: strategy ?? null,
      generatedWorkoutPlan: workoutPlan ?? null,
      workoutLocation: workoutLocation === "home" ? "home" : "gym",
      workoutOnboardingAt: new Date().toISOString(),
    };

    await db
      .update(userProfiles)
      .set({
        fitnessGoal: goal,
        onboardingData: updatedExtra as any,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId));

    if (workoutPlan && strategy) {
      const planId = await saveOnboardingPlanDirectly(userId, goal, workoutPlan as any[], strategy);
      if (!planId) {
        return res.status(500).json({ success: false, error: "Failed to persist workout plan to database" });
      }
      return res.json({ success: true, planId });
    }

    return res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to save workout onboarding");
    return res.status(500).json({ error: "Failed to save onboarding data" });
  }
}

// ΓöÇΓöÇΓöÇ POST /api/workout/onboarding/reset ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
export async function resetOnboarding(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  try {
    const [existingProfile] = await db
      .select({ onboardingData: userProfiles.onboardingData })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    const existingExtra = (existingProfile?.onboardingData as Record<string, unknown> | null) ?? {};
    const updatedExtra = { ...existingExtra, workoutOnboardingCompleted: false };

    await db
      .update(userProfiles)
      .set({ onboardingData: updatedExtra as any, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));

    return res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, "Failed to reset workout onboarding");
    return res.status(500).json({ error: "Failed to reset" });
  }
}

// ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function buildRecommendationPrompt(
  metrics: Record<string, string>,
  analysis: Record<string, unknown> | null,
): string {
  const bodyFat = metrics.bodyFat ?? "unknown";
  const bmi = metrics.bmi ?? "unknown";
  const smm = metrics.skeletalMuscleMass ?? "unknown";
  const visceralFat = metrics.visceralFat ?? "unknown";
  const whr = metrics.waistHipRatio ?? "unknown";
  const weight = metrics.weight ?? "unknown";
  const targetWeight = metrics.targetWeight ?? "unknown";
  const obesityDegree = metrics.obesityDegree ?? "unknown";

  const analysisSummary = analysis
    ? `Overall: ${(analysis as any)?.overallSummary ?? "N/A"}. Fitness level: ${(analysis as any)?.fitnessLevel ?? "N/A"}.`
    : "No AI analysis available.";

  return `InBody Report Data:
- Body Fat %: ${bodyFat}%
- BMI: ${bmi}
- Skeletal Muscle Mass: ${smm} kg
- Visceral Fat Level: ${visceralFat}
- Waist-Hip Ratio: ${whr}
- Weight: ${weight} kg
- Target Weight: ${targetWeight} kg
- Obesity Degree: ${obesityDegree}%

AI Analysis Summary: ${analysisSummary}

Based on this data, what is the single best starting fitness goal for this person?`;
}

function inferGoalFromMetrics(metrics: Record<string, string>): FitnessGoal {
  const bodyFat = parseFloat(metrics.bodyFat ?? "25");
  const bmi = parseFloat(metrics.bmi ?? "25");
  const smm = parseFloat(metrics.skeletalMuscleMass ?? "30");

  if (bodyFat > 30 || bmi > 28) return "Fat Loss";
  if (bodyFat > 22 && smm < 35) return "Body Recomposition";
  if (smm < 28) return "Muscle Gain";
  return "General Fitness";
}

function buildFallbackRecommendation(metrics: Record<string, string>) {
  const goal = inferGoalFromMetrics(metrics);
  const bodyFat = metrics.bodyFat ?? "ΓÇö";
  const bmi = metrics.bmi ?? "ΓÇö";

  return {
    recommendedGoal: goal,
    reasoning: `Based on your body fat of ${bodyFat}% and BMI of ${bmi}, ${goal} is the most appropriate starting goal to improve your body composition and health markers.`,
    transformationPriority: goal === "Fat Loss" ? "Reducing body fat and visceral fat" : "Building lean muscle mass",
    estimatedTimeline: "8ΓÇô12 weeks to see measurable results",
    beginnerSuitability: "Beginner",
    confidence: 75,
  };
}

interface WorkoutStrategy {
  split: string;
  splitName: string;
  daysPerWeek: number;
  sessionDuration: string;
  intensity: string;
  cardioFrequency: string;
  progressionStyle: string;
  beginnerFriendly: boolean;
  trainingDays: Array<{
    dayName: string;
    focus: string;
    bodyParts: string[];
    isCardio: boolean;
    isRest: boolean;
    sets: number;
    repsRange: string;
    restSeconds: number;
  }>;
}

function ensureTrainingDays(
  days: WorkoutStrategy["trainingDays"],
  fallback: WorkoutStrategy["trainingDays"],
): WorkoutStrategy["trainingDays"] {
  const source = days.length >= 7 ? days : fallback;
  return source.map((day, index) => ({
    ...day,
    dayName: day.dayName?.trim() || WEEKDAY_NAMES[index] || `Day ${index + 1}`,
    focus:
      day.focus?.trim() ||
      (day.isRest ? "Rest" : day.isCardio ? "Cardio" : "Training"),
    bodyParts: Array.isArray(day.bodyParts) ? day.bodyParts : [],
    isCardio: Boolean(day.isCardio),
    isRest: Boolean(day.isRest),
    sets: day.sets ?? 3,
    repsRange: day.repsRange ?? "10-12",
    restSeconds: day.restSeconds ?? 60,
  }));
}

async function buildWorkoutStrategy(
  goal: FitnessGoal,
  metrics: Record<string, string>,
  analysis: Record<string, unknown>,
  level: string,
  preferences?: string,
  location: WorkoutLocation = "gym",
): Promise<WorkoutStrategy> {
  const baseStrategy = getDefaultStrategy(goal, level);
  baseStrategy.trainingDays = ensureTrainingDays(baseStrategy.trainingDays, baseStrategy.trainingDays);

  if (!groq) {
    return baseStrategy;
  }

  const bodyFat = metrics.bodyFat ?? "unknown";
  const smm = metrics.skeletalMuscleMass ?? "unknown";
  const bmi = metrics.bmi ?? "unknown";
  const visceralFat = metrics.visceralFat ?? "unknown";

  const goalSplitGuide = getGoalSplitGuide(goal);
  const locationNote =
    location === "home"
      ? "User trains at HOME with bodyweight, dumbbells, and resistance bands only — no machines, barbells, or cables."
      : "User trains at a GYM with full equipment access.";

  const prompt = `Goal: ${goal}
Level: ${level}
Training location: ${location}
Body Fat: ${bodyFat}%, SMM: ${smm} kg, BMI: ${bmi}, Visceral Fat: ${visceralFat}
User preferences: ${preferences?.trim() || "none specified"}

${locationNote}

${goalSplitGuide}

Design a weekly workout strategy. Return ONLY valid JSON (no extra fields):
{
  "split": "<must match goal ΓÇö see guide above>",
  "splitName": "<human-readable plan name aligned with goal>",
  "daysPerWeek": 4,
  "sessionDuration": "45-55 min",
  "intensity": "Moderate",
  "cardioFrequency": "3x per week",
  "progressionStyle": "Volume progression",
  "beginnerFriendly": true,
  "trainingDays": [ ... 7 days ... ]
}

Rules:
- trainingDays must cover all 7 days (rest days: isRest true; cardio days: isCardio true)
- bodyParts: chest, back, upper legs, lower legs, shoulders, upper arms, lower arms, waist, cardio
- For Fat Loss: NEVER use Push Pull Legs / PPL ΓÇö use Hybrid Fat Loss or Upper/Lower with 2+ cardio days
- For Muscle Gain / Strength: PPL or Upper/Lower is OK
- Match intensity to body fat level
- For home training: prefer full-body splits, shorter sessions (35-45 min), bodyweight and dumbbell-friendly exercises`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a certified fitness coach. Return ONLY valid JSON. The split and splitName MUST match the user's stated fitness goal.",
        },
        { role: "user", content: prompt },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const aiStrategy = JSON.parse(raw) as WorkoutStrategy;

    if (!Array.isArray(aiStrategy.trainingDays) || aiStrategy.trainingDays.length === 0) {
      throw new Error("Invalid strategy");
    }

    return normalizeStrategyForGoal(aiStrategy, baseStrategy, goal);
  } catch (err: any) {
    logger.warn({ err: err.message, goal }, "Strategy generation failed ΓÇö using default");
    return baseStrategy;
  }
}

function getGoalSplitGuide(goal: FitnessGoal): string {
  switch (goal) {
    case "Fat Loss":
      return `REQUIRED for Fat Loss:
- split must be "Hybrid Fat Loss" or "Upper Lower" (NOT PPL)
- splitName examples: "Fat Loss Hybrid Split", "Fat Loss Upper/Lower"
- Include 2-3 dedicated cardio days per week
- Focus on full-body / upper-lower with higher reps (12-15)`;
    case "Muscle Gain":
      return `For Muscle Gain: split "PPL" or "Upper Lower", splitName e.g. "Push Pull Legs" or "Upper Lower Hypertrophy"`;
    case "Strength":
      return `For Strength: split "PPL" or "Upper Lower", splitName e.g. "Strength PPL" or "Upper Lower Strength"`;
    case "Body Recomposition":
      return `For Body Recomposition: "Upper Lower" or "Full Body", 2 cardio days, splitName e.g. "Recomp Upper/Lower"`;
    case "Athletic Performance":
      return `For Athletic Performance: "Full Body" or hybrid, include cardio/agility days, splitName e.g. "Athletic Performance Plan"`;
    default:
      return `For General Fitness: "Full Body" 3-day split, 2 cardio days, splitName e.g. "Full Body 3-Day"`;
  }
}

function normalizeStrategyForGoal(
  ai: WorkoutStrategy,
  fallback: WorkoutStrategy,
  goal: FitnessGoal,
): WorkoutStrategy {
  const splitLower = (ai.split ?? "").toLowerCase();
  const nameLower = (ai.splitName ?? "").toLowerCase();
  const isPpl = splitLower === "ppl" || splitLower.includes("push pull") || nameLower.includes("push pull");

  if (goal === "Fat Loss" && isPpl) {
    logger.info({ goal, aiSplit: ai.split }, "AI returned PPL for Fat Loss ΓÇö using goal default");
    return {
      ...fallback,
      intensity: ai.intensity || fallback.intensity,
      cardioFrequency: ai.cardioFrequency || fallback.cardioFrequency,
      progressionStyle: ai.progressionStyle || fallback.progressionStyle,
    };
  }

  if (goal === "Fat Loss" && !splitLower.includes("fat") && !splitLower.includes("upper lower") && !splitLower.includes("full body")) {
    return { ...fallback, intensity: ai.intensity || fallback.intensity };
  }

  if ((goal === "General Fitness" || goal === "Athletic Performance") && isPpl) {
    return { ...fallback, intensity: ai.intensity || fallback.intensity };
  }

  return {
    ...fallback,
    ...ai,
    split: ai.split || fallback.split,
    splitName: ai.splitName || fallback.splitName,
    trainingDays: ensureTrainingDays(ai.trainingDays, fallback.trainingDays),
  };
}

function getDefaultStrategy(goal: FitnessGoal, level: string): WorkoutStrategy {
  const isBeginnerOrFatLoss = level === "beginner" || goal === "Fat Loss";

  if (goal === "Fat Loss") {
    return {
      split: "Hybrid Fat Loss",
      splitName: "Fat Loss Workout Plan",
      daysPerWeek: 5,
      sessionDuration: "40-50 min",
      intensity: "Moderate-High",
      cardioFrequency: "3x per week",
      progressionStyle: "Volume progression",
      beginnerFriendly: true,
      trainingDays: [
        { dayName: "Monday", focus: "Upper Body", bodyParts: ["chest", "back", "shoulders"], isCardio: false, isRest: false, sets: 3, repsRange: "12-15", restSeconds: 45 },
        { dayName: "Tuesday", focus: "Cardio", bodyParts: ["cardio"], isCardio: true, isRest: false, sets: 1, repsRange: "20-30 min", restSeconds: 0 },
        { dayName: "Wednesday", focus: "Lower Body", bodyParts: ["upper legs", "lower legs"], isCardio: false, isRest: false, sets: 3, repsRange: "12-15", restSeconds: 60 },
        { dayName: "Thursday", focus: "Rest", bodyParts: [], isCardio: false, isRest: true, sets: 0, repsRange: "", restSeconds: 0 },
        { dayName: "Friday", focus: "Full Body", bodyParts: ["chest", "back", "upper legs"], isCardio: false, isRest: false, sets: 3, repsRange: "10-12", restSeconds: 60 },
        { dayName: "Saturday", focus: "Cardio", bodyParts: ["cardio"], isCardio: true, isRest: false, sets: 1, repsRange: "25-40 min", restSeconds: 0 },
        { dayName: "Sunday", focus: "Rest", bodyParts: [], isCardio: false, isRest: true, sets: 0, repsRange: "", restSeconds: 0 },
      ],
    };
  }

  if (goal === "Muscle Gain" || goal === "Strength") {
    return {
      split: "PPL",
      splitName: "Push Pull Legs",
      daysPerWeek: 6,
      sessionDuration: "55-65 min",
      intensity: "High",
      cardioFrequency: "1-2x per week",
      progressionStyle: "Linear progression",
      beginnerFriendly: false,
      trainingDays: [
        { dayName: "Monday", focus: "Push", bodyParts: ["chest", "shoulders", "upper arms"], isCardio: false, isRest: false, sets: 4, repsRange: "8-10", restSeconds: 90 },
        { dayName: "Tuesday", focus: "Pull", bodyParts: ["back", "upper arms"], isCardio: false, isRest: false, sets: 4, repsRange: "8-10", restSeconds: 90 },
        { dayName: "Wednesday", focus: "Legs", bodyParts: ["upper legs", "lower legs"], isCardio: false, isRest: false, sets: 4, repsRange: "8-10", restSeconds: 90 },
        { dayName: "Thursday", focus: "Push", bodyParts: ["chest", "shoulders", "upper arms"], isCardio: false, isRest: false, sets: 4, repsRange: "10-12", restSeconds: 75 },
        { dayName: "Friday", focus: "Pull", bodyParts: ["back", "upper arms"], isCardio: false, isRest: false, sets: 4, repsRange: "10-12", restSeconds: 75 },
        { dayName: "Saturday", focus: "Legs", bodyParts: ["upper legs", "lower legs"], isCardio: false, isRest: false, sets: 4, repsRange: "10-12", restSeconds: 75 },
        { dayName: "Sunday", focus: "Rest", bodyParts: [], isCardio: false, isRest: true, sets: 0, repsRange: "", restSeconds: 0 },
      ],
    };
  }

  return {
    split: "Full Body",
    splitName: "Full Body 3-Day",
    daysPerWeek: 3,
    sessionDuration: "45-55 min",
    intensity: "Moderate",
    cardioFrequency: "2x per week",
    progressionStyle: "Linear progression",
    beginnerFriendly: true,
    trainingDays: [
      { dayName: "Monday", focus: "Full Body A", bodyParts: ["chest", "back", "upper legs"], isCardio: false, isRest: false, sets: 3, repsRange: "10-12", restSeconds: 60 },
      { dayName: "Tuesday", focus: "Rest", bodyParts: [], isCardio: false, isRest: true, sets: 0, repsRange: "", restSeconds: 0 },
      { dayName: "Wednesday", focus: "Full Body B", bodyParts: ["shoulders", "upper arms", "upper legs"], isCardio: false, isRest: false, sets: 3, repsRange: "10-12", restSeconds: 60 },
      { dayName: "Thursday", focus: "Cardio", bodyParts: ["cardio"], isCardio: true, isRest: false, sets: 1, repsRange: "20-30 min", restSeconds: 0 },
      { dayName: "Friday", focus: "Full Body C", bodyParts: ["chest", "back", "shoulders"], isCardio: false, isRest: false, sets: 3, repsRange: "10-12", restSeconds: 60 },
      { dayName: "Saturday", focus: "Cardio", bodyParts: ["cardio"], isCardio: true, isRest: false, sets: 1, repsRange: "20 min", restSeconds: 0 },
      { dayName: "Sunday", focus: "Rest", bodyParts: [], isCardio: false, isRest: true, sets: 0, repsRange: "", restSeconds: 0 },
    ],
  };
}

/**
 * POST /api/workout/onboarding/generate-unified
 * One-step: optional AI goal pick + structured plan from catalog + real metrics.
 */
export async function generateUnifiedPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const {
    goal: manualGoal,
    level = "beginner",
    preferences,
    useAiGoal = true,
    workoutLocation = "gym",
  } = req.body as {
    goal?: FitnessGoal;
    level?: string;
    preferences?: string;
    useAiGoal?: boolean;
    workoutLocation?: WorkoutLocation;
  };
  const location: WorkoutLocation = workoutLocation === "home" ? "home" : "gym";

  try {
    const planContext = await getWorkoutPlanContext(userId);
    if (planContext.hasTrainerAssigned) {
      return res.status(403).json({
        success: false,
        error: "Your trainer manages your plan. Contact them for updates.",
        planSource: "trainer",
      });
    }

    const [report] = await db
      .select({ extractedMetrics: inbodyReports.extractedMetrics, geminiAnalysis: inbodyReports.geminiAnalysis })
      .from(inbodyReports)
      .where(eq(inbodyReports.userId, userId))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1);

    const metrics = (report?.extractedMetrics as Record<string, string> | null) ?? {};
    const analysis = (report?.geminiAnalysis as Record<string, unknown> | null) ?? {};
    const metricsConsidered = buildMetricsSnapshot(metrics, Boolean(report));

    let resolvedGoal = manualGoal;
    let aiRecommendation = null;

    if (useAiGoal && report?.extractedMetrics) {
      if (groq) {
        try {
          const prompt = buildRecommendationPrompt(metrics, analysis);
          const completion = await groq.chat.completions.create({
            messages: [
              {
                role: "system",
                content: `You are an elite fitness coach. Return ONLY valid JSON: {"recommendedGoal":"Fat Loss|Muscle Gain|Body Recomposition|Strength|Athletic Performance|General Fitness","reasoning":"...","transformationPriority":"...","estimatedTimeline":"...","beginnerSuitability":"Beginner|Intermediate|Advanced","confidence":85}`,
              },
              { role: "user", content: prompt },
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.3,
            max_tokens: 600,
            response_format: { type: "json_object" },
          });
          const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
          if (FITNESS_GOALS.includes(parsed.recommendedGoal)) {
            aiRecommendation = parsed;
            if (!resolvedGoal) resolvedGoal = parsed.recommendedGoal;
          }
        } catch {
          /* fallback below */
        }
      }
      if (!aiRecommendation) {
        const inferred = inferGoalFromMetrics(metrics);
        aiRecommendation = {
          recommendedGoal: inferred,
          reasoning: `Based on your InBody: body fat ${metrics.bodyFat ?? "ΓÇö"}%, muscle mass ${metrics.skeletalMuscleMass ?? "ΓÇö"} kg.`,
          transformationPriority: inferred === "Fat Loss" ? "Reduce body fat" : "Build lean mass",
          estimatedTimeline: "8ΓÇô12 weeks",
          beginnerSuitability: "Beginner",
          confidence: 80,
        };
        if (!resolvedGoal) resolvedGoal = inferred;
      }
    }

    if (!resolvedGoal) {
      if (manualGoal) {
        resolvedGoal = manualGoal;
      } else if (!report?.extractedMetrics) {
        resolvedGoal = "General Fitness";
      }
    }

    if (!resolvedGoal) {
      return res.status(400).json({ error: "Select a goal or upload InBody for AI recommendation" });
    }

    if (!FITNESS_GOALS.includes(resolvedGoal)) {
      return res.status(400).json({ error: "Invalid fitness goal" });
    }

    const strategy = await buildWorkoutStrategy(resolvedGoal, metrics, analysis, level, preferences, location);
    const plan = await buildStructuredExercisePlan(strategy.trainingDays, strategy.sessionDuration);

    return res.json({
      success: true,
      goal: resolvedGoal,
      aiRecommendation,
      strategy,
      plan,
      metricsConsidered,
      planSource: "ai",
      workoutLocation: location,
    });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Unified plan generation failed");
    return res.status(500).json({ error: "Failed to generate workout plan" });
  }
}

/**
 * Workout Onboarding Controller
 * ------------------------------
 * Handles AI goal recommendation, workout plan generation,
 * status checks, and saving onboarding results.
 */

import type { Response } from "express";
import { db, inbodyReports, userProfiles } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import Groq from "groq-sdk";
import type { AuthenticatedRequest } from "../lib/auth";
import { fetchExercisesByBodyPart } from "../lib/exercisedb";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const FITNESS_GOALS = [
  "Fat Loss",
  "Muscle Gain",
  "Body Recomposition",
  "Strength",
  "Athletic Performance",
  "General Fitness",
] as const;

export type FitnessGoal = typeof FITNESS_GOALS[number];

// ─── GET /api/workout/onboarding/status ───────────────────────────────────────
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

    // Check for InBody report
    const [latestReport] = await db
      .select({ id: inbodyReports.id, extractedMetrics: inbodyReports.extractedMetrics, geminiAnalysis: inbodyReports.geminiAnalysis })
      .from(inbodyReports)
      .where(eq(inbodyReports.userId, userId))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1);

    return res.json({
      completed: workoutOnboardingCompleted,
      fitnessGoal: profile.fitnessGoal ?? extra.selectedGoal ?? null,
      workoutPlan: extra.generatedWorkoutPlan ?? null,
      hasInBodyReport: Boolean(latestReport),
      latestReportId: latestReport?.id ?? null,
    });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get workout onboarding status");
    return res.status(500).json({ error: "Failed to get onboarding status" });
  }
}

// ─── POST /api/workout/onboarding/ai-recommend ────────────────────────────────
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

// ─── POST /api/workout/onboarding/generate-plan ───────────────────────────────
export async function generateWorkoutPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { goal, level = "beginner" } = req.body as { goal: FitnessGoal; level?: string };

  if (!goal || !FITNESS_GOALS.includes(goal)) {
    return res.status(400).json({ error: "Invalid fitness goal" });
  }

  try {
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
    let strategy = await buildWorkoutStrategy(goal, metrics, analysis, level);

    // Step 2: Fetch exercises from ExerciseDB for each training day
    const plan = await buildExercisePlan(strategy, goal);

    return res.json({
      success: true,
      strategy,
      plan,
    });
  } catch (err: any) {
    logger.error({ err: err.message, userId, goal }, "Workout plan generation failed");
    return res.status(500).json({ error: "Failed to generate workout plan. Please try again." });
  }
}

// ─── POST /api/workout/onboarding/save ────────────────────────────────────────
export async function saveOnboarding(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { goal, aiRecommendedGoal, workoutPlan, strategy } = req.body as {
    goal: string;
    aiRecommendedGoal?: string;
    workoutPlan?: unknown;
    strategy?: unknown;
  };

  if (!goal) {
    return res.status(400).json({ error: "goal is required" });
  }

  try {
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

    return res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to save workout onboarding");
    return res.status(500).json({ error: "Failed to save onboarding data" });
  }
}

// ─── POST /api/workout/onboarding/reset ───────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const bodyFat = metrics.bodyFat ?? "—";
  const bmi = metrics.bmi ?? "—";

  return {
    recommendedGoal: goal,
    reasoning: `Based on your body fat of ${bodyFat}% and BMI of ${bmi}, ${goal} is the most appropriate starting goal to improve your body composition and health markers.`,
    transformationPriority: goal === "Fat Loss" ? "Reducing body fat and visceral fat" : "Building lean muscle mass",
    estimatedTimeline: "8–12 weeks to see measurable results",
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

async function buildWorkoutStrategy(
  goal: FitnessGoal,
  metrics: Record<string, string>,
  analysis: Record<string, unknown>,
  level: string,
): Promise<WorkoutStrategy> {
  if (!groq) {
    return getDefaultStrategy(goal, level);
  }

  const bodyFat = metrics.bodyFat ?? "unknown";
  const smm = metrics.skeletalMuscleMass ?? "unknown";
  const bmi = metrics.bmi ?? "unknown";
  const visceralFat = metrics.visceralFat ?? "unknown";

  const prompt = `Goal: ${goal}
Level: ${level}
Body Fat: ${bodyFat}%, SMM: ${smm} kg, BMI: ${bmi}, Visceral Fat: ${visceralFat}

Design a weekly workout strategy. Return ONLY this JSON structure (no extra fields):
{
  "split": "PPL|Upper Lower|Full Body|Hybrid Fat Loss",
  "splitName": "Push Pull Legs",
  "daysPerWeek": 4,
  "sessionDuration": "45-55 min",
  "intensity": "Moderate",
  "cardioFrequency": "3x per week",
  "progressionStyle": "Linear progression",
  "beginnerFriendly": true,
  "trainingDays": [
    {
      "dayName": "Monday",
      "focus": "Push",
      "bodyParts": ["chest", "shoulders", "upper arms"],
      "isCardio": false,
      "isRest": false,
      "sets": 3,
      "repsRange": "10-12",
      "restSeconds": 60
    }
  ]
}

Rules:
- trainingDays must cover all 7 days (include rest days with isRest: true and cardio days with isCardio: true)
- bodyParts must be exact values from: chest, back, upper legs, lower legs, shoulders, upper arms, lower arms, waist, cardio
- For rest days set bodyParts to []
- For beginners use 3 days training + 1-2 cardio + rest
- For Fat Loss include more cardio days and shorter rest periods
- Match intensity to body fat level`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a certified fitness coach. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const strategy = JSON.parse(raw) as WorkoutStrategy;

    if (!Array.isArray(strategy.trainingDays) || strategy.trainingDays.length === 0) {
      throw new Error("Invalid strategy");
    }

    return strategy;
  } catch (err: any) {
    logger.warn({ err: err.message, goal }, "Strategy generation failed — using default");
    return getDefaultStrategy(goal, level);
  }
}

function getDefaultStrategy(goal: FitnessGoal, level: string): WorkoutStrategy {
  const isBeginnerOrFatLoss = level === "beginner" || goal === "Fat Loss";

  if (goal === "Fat Loss") {
    return {
      split: "Hybrid Fat Loss",
      splitName: "Fat Loss Hybrid Split",
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

export interface ExercisePlanDay {
  dayName: string;
  focus: string;
  isRest: boolean;
  isCardio: boolean;
  estimatedCalories: number;
  estimatedDuration: string;
  exercises: Array<{
    id: string;
    name: string;
    bodyPart: string;
    target: string;
    secondaryMuscles: string[];
    equipment: string;
    gifUrl: string;
    instructions: string[];
    sets: number;
    repsRange: string;
    restSeconds: number;
    estimatedCaloriesPerSet: number;
    difficulty: string;
  }>;
}

async function buildExercisePlan(
  strategy: WorkoutStrategy,
  goal: FitnessGoal,
): Promise<ExercisePlanDay[]> {
  const plan: ExercisePlanDay[] = [];

  for (const day of strategy.trainingDays) {
    if (day.isRest) {
      plan.push({
        dayName: day.dayName,
        focus: "Rest",
        isRest: true,
        isCardio: false,
        estimatedCalories: 0,
        estimatedDuration: "—",
        exercises: [],
      });
      continue;
    }

    if (day.isCardio) {
      const cardioExercises = await fetchExercisesByBodyPart("cardio", 3);
      plan.push({
        dayName: day.dayName,
        focus: day.focus,
        isRest: false,
        isCardio: true,
        estimatedCalories: 280,
        estimatedDuration: day.repsRange || "30 min",
        exercises: cardioExercises.map((ex) => ({
          ...ex,
          sets: 1,
          repsRange: day.repsRange || "30 min",
          restSeconds: 0,
          estimatedCaloriesPerSet: 90,
          difficulty: "Beginner",
        })),
      });
      continue;
    }

    const allExercises: ExercisePlanDay["exercises"] = [];

    for (const bodyPart of day.bodyParts) {
      const exLimit = Math.min(3, Math.ceil(6 / day.bodyParts.length));
      const fetched = await fetchExercisesByBodyPart(bodyPart, exLimit);

      for (const ex of fetched) {
        const difficulty = day.sets >= 4 ? "Intermediate" : "Beginner";
        const calsPerSet = estimateCalsPerSet(bodyPart, day.sets);

        allExercises.push({
          ...ex,
          sets: day.sets,
          repsRange: day.repsRange,
          restSeconds: day.restSeconds,
          estimatedCaloriesPerSet: calsPerSet,
          difficulty,
        });
      }
    }

    const totalCals = allExercises.reduce(
      (sum, ex) => sum + ex.estimatedCaloriesPerSet * ex.sets,
      0,
    );

    plan.push({
      dayName: day.dayName,
      focus: day.focus,
      isRest: false,
      isCardio: false,
      estimatedCalories: Math.round(totalCals),
      estimatedDuration: strategy.sessionDuration,
      exercises: allExercises,
    });
  }

  return plan;
}

function estimateCalsPerSet(bodyPart: string, sets: number): number {
  const map: Record<string, number> = {
    chest: 14,
    back: 16,
    "upper legs": 22,
    "lower legs": 8,
    shoulders: 10,
    "upper arms": 8,
    "lower arms": 6,
    waist: 10,
    cardio: 90,
  };
  return map[bodyPart] ?? 12;
}

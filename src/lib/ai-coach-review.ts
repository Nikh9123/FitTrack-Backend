import Groq from "groq-sdk";
import type { CoachReviewContext, DailyDigestContext } from "../services/coachReviewTypes";
import { logger } from "./logger";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const MODEL = process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";

export interface CoachReviewNarrative {
  aiSummary: string;
  progressAnalysis: {
    weight: string;
    activity: string;
    nutrition: string;
    recovery: string;
  };
  coachInsights: string[];
  drivers: {
    helped: string[];
    holdingBack: string[];
  };
  nextWeekFocus: string;
  source: "groq" | "fallback";
}

export function buildFallbackNarrative(context: CoachReviewContext): CoachReviewNarrative {
  const { summary, trends, goal, drivers } = context;
  const weightLine =
    summary.weight.change !== 0
      ? `Weight moved ${summary.weight.change > 0 ? "up" : "down"} ${Math.abs(summary.weight.change)} kg.`
      : "Weight held steady this week.";

  const aiSummary = [
    `Overall fitness score: ${context.summary.overallScore}/100.`,
    weightLine,
    `You logged ${summary.workouts.completed}/${summary.workouts.planned} workouts with ${summary.workouts.consistencyPct}% consistency.`,
    goal.message,
  ].join(" ");

  return {
    aiSummary,
    progressAnalysis: {
      weight: weightLine,
      activity: `${summary.steps.toLocaleString()} steps and ${summary.caloriesBurned.toLocaleString()} kcal burned.`,
      nutrition: `${summary.caloriesConsumed.toLocaleString()} kcal consumed · protein avg ${summary.proteinAvgG}g.`,
      recovery: `${summary.sleepGoalDays}/7 sleep goal days · recovery trend ${trends.recovery}.`,
    },
    coachInsights: [
      summary.workouts.consistencyPct >= 80
        ? "Workout consistency was strong — keep the same schedule."
        : "Try locking in 2–3 fixed workout times to boost consistency.",
      summary.waterGoalDays >= 5
        ? "Hydration was on point most days."
        : "Increase water intake — aim for your daily glass target.",
      summary.sleepGoalDays >= 5
        ? "Sleep supported your recovery well."
        : "Prioritise 7+ hours of sleep for better recovery scores.",
    ],
    drivers: {
      helped: drivers.positive.length ? drivers.positive : ["Consistent logging unlocks sharper insights."],
      holdingBack: drivers.negative.length ? drivers.negative : ["No major blockers detected — stay consistent."],
    },
    nextWeekFocus: `Target ${context.nextWeekGoals.steps.toLocaleString()} steps/day and ${context.nextWeekGoals.workouts} workouts.`,
    source: "fallback",
  };
}

export async function generateWeeklyReviewNarrative(
  context: CoachReviewContext,
): Promise<CoachReviewNarrative> {
  const fallback = buildFallbackNarrative(context);
  if (!groq) return fallback;

  const prompt = `You are Veera's AI fitness coach. Narrate a weekly review using ONLY the pre-computed JSON below. Do NOT invent numbers.

Return JSON:
{
  "aiSummary": "2-3 sentence overview",
  "progressAnalysis": { "weight": "...", "activity": "...", "nutrition": "...", "recovery": "..." },
  "coachInsights": ["...", "...", "..."],
  "drivers": { "helped": ["..."], "holdingBack": ["..."] },
  "nextWeekFocus": "one sentence"
}

Data:
${JSON.stringify(context, null, 2)}`;

  try {
    const result = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.35,
      max_tokens: 900,
      response_format: { type: "json_object" },
    });

    const raw = result.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Partial<CoachReviewNarrative>;

    return {
      aiSummary: parsed.aiSummary ?? fallback.aiSummary,
      progressAnalysis: {
        weight: parsed.progressAnalysis?.weight ?? fallback.progressAnalysis.weight,
        activity: parsed.progressAnalysis?.activity ?? fallback.progressAnalysis.activity,
        nutrition: parsed.progressAnalysis?.nutrition ?? fallback.progressAnalysis.nutrition,
        recovery: parsed.progressAnalysis?.recovery ?? fallback.progressAnalysis.recovery,
      },
      coachInsights: parsed.coachInsights?.length ? parsed.coachInsights : fallback.coachInsights,
      drivers: {
        helped: parsed.drivers?.helped?.length ? parsed.drivers.helped : fallback.drivers.helped,
        holdingBack: parsed.drivers?.holdingBack?.length ? parsed.drivers.holdingBack : fallback.drivers.holdingBack,
      },
      nextWeekFocus: parsed.nextWeekFocus ?? fallback.nextWeekFocus,
      source: "groq",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Groq review failed";
    logger.warn({ err: message }, "generateWeeklyReviewNarrative fallback");
    return fallback;
  }
}

export async function generateMonthlyReviewNarrative(
  context: CoachReviewContext,
): Promise<CoachReviewNarrative> {
  return generateWeeklyReviewNarrative(context);
}

export function buildFallbackDailyDigest(context: DailyDigestContext): {
  tip: string;
  focusAction: string;
  category: "nutrition" | "activity" | "recovery" | "consistency" | "general";
} {
  const y = context.yesterday;
  if (y.steps === 0 && y.caloriesConsumed === 0 && !y.workoutCompleted) {
    return {
      tip: "No activity logged yesterday — start fresh today with one small win.",
      focusAction: "Log breakfast or a 10-minute walk before noon.",
      category: "consistency",
    };
  }
  if (y.caloriesConsumed === 0) {
    return {
      tip: "Meals weren't logged yesterday, so your coach can't fine-tune nutrition advice.",
      focusAction: "Log every meal today to unlock accurate daily tips.",
      category: "nutrition",
    };
  }
  if (y.steps > 0 && y.steps < 4000) {
    return {
      tip: `Yesterday's ${y.steps.toLocaleString()} steps were below an active baseline for your ${context.fitnessGoal ?? "fitness"} goal.`,
      focusAction: "Add a 15-minute walk after lunch today.",
      category: "activity",
    };
  }
  if (!y.workoutCompleted && context.streakDays > 0) {
    return {
      tip: `You're on a ${context.streakDays}-day streak — keep momentum with movement today.`,
      focusAction: "Complete a workout or 20 minutes of strength training.",
      category: "activity",
    };
  }
  if (y.sleepHours > 0 && y.sleepHours < 6.5) {
    return {
      tip: `Sleep logged at ${y.sleepHours}h — recovery drives fat loss and performance.`,
      focusAction: "Aim for 7+ hours tonight; wind down 30 minutes earlier.",
      category: "recovery",
    };
  }
  if (y.steps >= 8000 || y.workoutCompleted) {
    return {
      tip: "Strong day yesterday — consistency compounds faster than perfect days.",
      focusAction: "Repeat yesterday's habits: log meals, hit your step target, and train if scheduled.",
      category: "consistency",
    };
  }
  return {
    tip: "Small daily logs help your coach give sharper guidance.",
    focusAction: "Track steps, meals, and water today.",
    category: "general",
  };
}

export async function generateDailyDigestNarrative(context: DailyDigestContext): Promise<{
  tip: string;
  focusAction: string;
  category: "nutrition" | "activity" | "recovery" | "consistency" | "general";
  source: "groq" | "fallback";
}> {
  const fallback = buildFallbackDailyDigest(context);
  if (!groq) return { ...fallback, source: "fallback" };

  const prompt = `You are Veera's AI fitness coach. Write ONE personalized daily tip based on yesterday's data.
Goal: ${context.fitnessGoal ?? "general fitness"}. Streak: ${context.streakDays} days.
${context.calorieGoal ? `User's daily calorie target: ${context.calorieGoal} kcal — use this exact number if recommending intake.` : "No calorie target on file — do not invent a specific calorie number."}

Return JSON only:
{"tip":"1-2 sentences referencing yesterday's actual metrics","focusAction":"one concrete action for today","category":"nutrition|activity|recovery|consistency|general"}

Use ONLY these numbers — do not invent metrics:
${JSON.stringify(context, null, 2)}`;

  try {
    const result = await groq.chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 280,
      response_format: { type: "json_object" },
    });
    const raw = result.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}") as Partial<{
      tip: string;
      focusAction: string;
      category: string;
    }>;
    const category = ["nutrition", "activity", "recovery", "consistency", "general"].includes(
      String(parsed.category),
    )
      ? (parsed.category as typeof fallback.category)
      : fallback.category;
    return {
      tip: parsed.tip ?? fallback.tip,
      focusAction: parsed.focusAction ?? fallback.focusAction,
      category,
      source: "groq",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Groq daily digest failed";
    logger.warn({ err: message }, "generateDailyDigestNarrative fallback");
    return { ...fallback, source: "fallback" };
  }
}

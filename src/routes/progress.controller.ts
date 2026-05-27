/**
 * Progress Tracking Controller
 * ----------------------------
 * AI-powered progress tracking: weight trends, body composition,
 * daily check-ins, AI insights, fitness score, and achievements.
 */

import type { Response } from "express";
import { db, weightLogs, inbodyReports, userStreaks, userAchievements, achievementDefinitions, dailyCheckins, activitySummaries } from "@workspace/db";
import { eq, desc, gte, and, lte } from "drizzle-orm";
import { logger } from "../lib/logger";
import type { AuthenticatedRequest } from "../lib/auth";
import Groq from "groq-sdk";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeQuery<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    logger.warn({ err: err.message }, "DB query failed, using fallback");
    return fallback;
  }
}

function weeksAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n * 7);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function buildWeightTrend(entries: any[]): Array<{ week: string; value: number; date: string }> {
  if (!entries.length) return [];
  const sorted = [...entries].sort((a, b) =>
    new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  // Sample up to 8 evenly-spaced data points
  const step = Math.max(1, Math.floor(sorted.length / 8));
  const sampled = sorted.filter((_, i) => i % step === 0).slice(0, 8);
  return sampled.map((e, i) => ({
    week: `W${i + 1}`,
    value: parseFloat(String(e.weightKg)),
    date: new Date(e.recordedAt).toISOString().split("T")[0],
  }));
}

function computeFitnessScore(params: {
  streak: number;
  inbodyScore: number | null;
  recentCheckin: any | null;
  weightEntries: number;
  achievementCount: number;
}): { score: number; breakdown: Record<string, number>; label: string } {
  const { streak, inbodyScore, recentCheckin, weightEntries, achievementCount } = params;

  // 5 components, each 0-20 pts
  const streakPts = Math.min(20, Math.round((streak / 30) * 20));
  const inbodyPts = inbodyScore ? Math.min(20, Math.round((inbodyScore / 100) * 20)) : 10;
  const recoveryPts = recentCheckin?.recoveryScore
    ? Math.min(20, Math.round(((recentCheckin.recoveryScore - 1) / 4) * 20))
    : 10;
  const logPts = Math.min(20, Math.round((Math.min(weightEntries, 30) / 30) * 20));
  const achievePts = Math.min(20, achievementCount * 4);

  const score = streakPts + inbodyPts + recoveryPts + logPts + achievePts;
  const label =
    score >= 80 ? "Excellent" :
    score >= 65 ? "Great" :
    score >= 50 ? "Good" :
    score >= 35 ? "Fair" : "Getting Started";

  return {
    score,
    breakdown: {
      streak: streakPts,
      bodyComp: inbodyPts,
      recovery: recoveryPts,
      consistency: logPts,
      achievements: achievePts,
    },
    label,
  };
}

// ─── GET /api/progress/dashboard ─────────────────────────────────────────────

export async function getProgressDashboard(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  const [weightEntries, inbodyHistory, streakRows, achievements, checkinToday, recentActivity] =
    await Promise.all([
      safeQuery(() =>
        db.select().from(weightLogs)
          .where(and(eq(weightLogs.userId, userId), gte(weightLogs.recordedAt, weeksAgo(10))))
          .orderBy(desc(weightLogs.recordedAt))
          .limit(56),
        []
      ),
      safeQuery(() =>
        db.select().from(inbodyReports)
          .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
          .orderBy(desc(inbodyReports.createdAt))
          .limit(10),
        []
      ),
      safeQuery(() =>
        db.select().from(userStreaks).where(eq(userStreaks.userId, userId)).limit(1),
        []
      ),
      safeQuery(() =>
        db.select({
          id: userAchievements.id,
          name: achievementDefinitions.name,
          description: achievementDefinitions.description,
          type: achievementDefinitions.type,
          points: achievementDefinitions.points,
          earnedAt: userAchievements.earnedAt,
        })
          .from(userAchievements)
          .innerJoin(achievementDefinitions, eq(userAchievements.achievementId, achievementDefinitions.id))
          .where(eq(userAchievements.userId, userId))
          .orderBy(desc(userAchievements.earnedAt))
          .limit(12),
        []
      ),
      safeQuery(() => {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return db.select().from(dailyCheckins)
          .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, todayStart)))
          .limit(1);
      }, []),
      safeQuery(() =>
        db.select().from(activitySummaries)
          .where(and(eq(activitySummaries.userId, userId), gte(activitySummaries.summaryDate, daysAgo(7))))
          .orderBy(desc(activitySummaries.summaryDate))
          .limit(7),
        []
      ),
    ]);

  const latestInbody = inbodyHistory[0] ?? null;
  const metrics = (latestInbody?.extractedMetrics ?? {}) as Record<string, string>;
  const analysis = (latestInbody?.geminiAnalysis ?? null) as any;

  const firstInbody = inbodyHistory.length > 1 ? inbodyHistory[inbodyHistory.length - 1] : null;
  const firstMetrics = (firstInbody?.extractedMetrics ?? {}) as Record<string, string>;

  const currentWeight =
    metrics.weight ? parseFloat(metrics.weight) :
    weightEntries[0] ? parseFloat(String(weightEntries[0].weightKg)) : null;

  const currentMetrics = {
    weight: currentWeight,
    bodyFat: metrics.bodyFat ? parseFloat(metrics.bodyFat) : null,
    muscle: metrics.skeletalMuscleMass ? parseFloat(metrics.skeletalMuscleMass) : null,
    bmi: metrics.bmi ? parseFloat(metrics.bmi) : null,
    bmr: metrics.bmr ? parseInt(metrics.bmr) : null,
    visceralFat: metrics.visceralFat ? parseInt(metrics.visceralFat) : null,
  };

  const transformationSummary = {
    weightLost: (firstMetrics.weight && metrics.weight)
      ? Math.max(0, parseFloat(firstMetrics.weight) - parseFloat(metrics.weight))
      : null,
    muscleGained: (firstMetrics.skeletalMuscleMass && metrics.skeletalMuscleMass)
      ? Math.max(0, parseFloat(metrics.skeletalMuscleMass) - parseFloat(firstMetrics.skeletalMuscleMass))
      : null,
    fatLost: (firstMetrics.bodyFat && metrics.bodyFat)
      ? Math.max(0, parseFloat(firstMetrics.bodyFat) - parseFloat(metrics.bodyFat))
      : null,
    scans: inbodyHistory.length,
    weeks: firstInbody
      ? Math.round((new Date(latestInbody!.createdAt).getTime() - new Date(firstInbody.createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000))
      : 0,
  };

  const fitnessScore = computeFitnessScore({
    streak: streakRows[0]?.currentStreak ?? 0,
    inbodyScore: analysis?.inbodyScore ? parseInt(analysis.inbodyScore) : null,
    recentCheckin: checkinToday[0] ?? null,
    weightEntries: weightEntries.length,
    achievementCount: achievements.length,
  });

  return res.json({
    weightTrend: buildWeightTrend(weightEntries),
    currentMetrics,
    transformationSummary,
    workoutStats: {
      streak: streakRows[0]?.currentStreak ?? 0,
      longestStreak: streakRows[0]?.longestStreak ?? 0,
    },
    fitnessScore,
    achievements,
    recentCheckin: checkinToday[0] ?? null,
    recentActivity: recentActivity.slice(0, 7).map(a => ({
      date: new Date(a.summaryDate).toISOString().split("T")[0],
      steps: a.steps,
      caloriesBurned: a.caloriesBurned,
      sleepMinutes: a.sleepMinutes,
    })),
    inbodyReports: inbodyHistory.map(r => {
      const m = (r.extractedMetrics ?? {}) as Record<string, string>;
      const a = (r.geminiAnalysis ?? null) as any;
      return {
        id: r.id,
        date: r.createdAt,
        weight: m.weight ?? null,
        bodyFat: m.bodyFat ?? null,
        muscleMass: m.skeletalMuscleMass ?? null,
        bmi: m.bmi ?? null,
        score: a?.inbodyScore ?? null,
        status: r.status,
        aiAnalysis: a,
      };
    }),
  });
}

// ─── POST /api/progress/checkin ───────────────────────────────────────────────

export async function saveCheckin(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { energyLevel, sleepHours, soreness, mood, recoveryScore, notes } = req.body;

  if (!energyLevel || energyLevel < 1 || energyLevel > 5) {
    return res.status(400).json({ error: "energyLevel must be 1–5" });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [saved] = await db.insert(dailyCheckins).values({
      userId,
      checkinDate: today,
      energyLevel: parseInt(energyLevel),
      sleepHours: sleepHours ? String(sleepHours) : null,
      soreness: soreness ? parseInt(soreness) : null,
      mood: mood ? parseInt(mood) : null,
      recoveryScore: recoveryScore ? parseInt(recoveryScore) : null,
      notes: notes ?? null,
    }).onConflictDoNothing().returning();

    return res.json({ success: true, checkin: saved ?? null });
  } catch (err: any) {
    logger.error({ err: err.message }, "saveCheckin failed");
    return res.status(500).json({ error: "Failed to save check-in" });
  }
}

// ─── GET /api/progress/checkin/today ─────────────────────────────────────────

export async function getTodayCheckin(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [checkin] = await db.select().from(dailyCheckins)
      .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, todayStart)))
      .limit(1);
    return res.json({ checkin: checkin ?? null });
  } catch (err: any) {
    logger.error({ err: err.message }, "getTodayCheckin failed");
    return res.status(500).json({ error: "Failed to fetch check-in" });
  }
}

// ─── POST /api/progress/weight ────────────────────────────────────────────────

export async function logWeight(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { weightKg, notes } = req.body;

  if (!weightKg || isNaN(parseFloat(weightKg))) {
    return res.status(400).json({ error: "weightKg is required" });
  }

  try {
    const [entry] = await db.insert(weightLogs).values({
      userId,
      weightKg: String(parseFloat(weightKg).toFixed(1)),
      recordedAt: new Date(),
      notes: notes ?? null,
    }).returning();

    return res.json({ success: true, entry });
  } catch (err: any) {
    logger.error({ err: err.message }, "logWeight failed");
    return res.status(500).json({ error: "Failed to log weight" });
  }
}

// ─── GET /api/progress/ai-insights ───────────────────────────────────────────

export async function getAIInsights(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  // Gather context
  const [latestInbody, recentCheckins, weightEntries, streakRows] = await Promise.all([
    safeQuery(() =>
      db.select().from(inbodyReports)
        .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
        .orderBy(desc(inbodyReports.createdAt))
        .limit(1),
      []
    ),
    safeQuery(() =>
      db.select().from(dailyCheckins)
        .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, daysAgo(7))))
        .orderBy(desc(dailyCheckins.checkinDate))
        .limit(7),
      []
    ),
    safeQuery(() =>
      db.select().from(weightLogs)
        .where(and(eq(weightLogs.userId, userId), gte(weightLogs.recordedAt, daysAgo(30))))
        .orderBy(desc(weightLogs.recordedAt))
        .limit(10),
      []
    ),
    safeQuery(() =>
      db.select().from(userStreaks).where(eq(userStreaks.userId, userId)).limit(1),
      []
    ),
  ]);

  const m = (latestInbody[0]?.extractedMetrics ?? {}) as Record<string, string>;
  const streak = streakRows[0]?.currentStreak ?? 0;
  const avgRecovery = recentCheckins.length > 0
    ? recentCheckins.filter(c => c.recoveryScore).reduce((s, c) => s + (c.recoveryScore ?? 0), 0) / recentCheckins.filter(c => c.recoveryScore).length
    : null;
  const avgEnergy = recentCheckins.length > 0
    ? recentCheckins.filter(c => c.energyLevel).reduce((s, c) => s + (c.energyLevel ?? 0), 0) / recentCheckins.filter(c => c.energyLevel).length
    : null;
  const weightTrend = weightEntries.length >= 2
    ? parseFloat(String(weightEntries[0].weightKg)) - parseFloat(String(weightEntries[weightEntries.length - 1].weightKg))
    : 0;

  // Fallback static insights if no Groq
  const fallbackInsights = buildFallbackInsights({ m, streak, avgRecovery, avgEnergy, weightTrend, checkins: recentCheckins });

  if (!groq) {
    return res.json({ insights: fallbackInsights, source: "static" });
  }

  const prompt = `You are a precision fitness coach AI. Based on the user's data below, generate exactly 4 short, personalized fitness insights (1-2 sentences each). Be specific — mention actual numbers. Be motivating but clinically honest.

User data:
- Body fat: ${m.bodyFat ?? "unknown"}%
- Muscle mass: ${m.skeletalMuscleMass ?? "unknown"} kg
- Weight: ${m.weight ?? "unknown"} kg (trend: ${weightTrend > 0.2 ? "gaining" : weightTrend < -0.2 ? "losing" : "stable"})
- Workout streak: ${streak} days
- Avg recovery (7d): ${avgRecovery !== null ? avgRecovery.toFixed(1) + "/5" : "not logged"}
- Avg energy (7d): ${avgEnergy !== null ? avgEnergy.toFixed(1) + "/5" : "not logged"}
- Check-in count this week: ${recentCheckins.length}
- InBody scan count: ${latestInbody.length > 0 ? "Yes, last was " + new Date(latestInbody[0].createdAt).toLocaleDateString() : "None yet"}

Return JSON only: { "insights": ["...", "...", "...", "..."], "weeklyGoal": "...", "recoveryAdvice": "..." }`;

  try {
    const result = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: "json_object" },
    });
    const raw = result.choices[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    return res.json({
      insights: parsed.insights ?? fallbackInsights,
      weeklyGoal: parsed.weeklyGoal ?? null,
      recoveryAdvice: parsed.recoveryAdvice ?? null,
      source: "groq",
    });
  } catch (err: any) {
    logger.warn({ err: err.message }, "Groq insights failed, using fallback");
    return res.json({ insights: fallbackInsights, source: "fallback" });
  }
}

function buildFallbackInsights(ctx: {
  m: Record<string, string>;
  streak: number;
  avgRecovery: number | null;
  avgEnergy: number | null;
  weightTrend: number;
  checkins: any[];
}): string[] {
  const insights: string[] = [];
  if (ctx.m.bodyFat) insights.push(`Body fat at ${ctx.m.bodyFat}% — ${parseFloat(ctx.m.bodyFat) < 20 ? "excellent range, focus on maintaining." : "reduce with consistent cardio and a mild calorie deficit."}`);
  if (ctx.m.skeletalMuscleMass) insights.push(`Muscle mass of ${ctx.m.skeletalMuscleMass} kg — keep progressive overload to continue growing.`);
  if (ctx.streak > 0) insights.push(`${ctx.streak}-day workout streak — consistency is the #1 predictor of long-term results.`);
  if (ctx.avgRecovery !== null && ctx.avgRecovery < 3) insights.push(`Average recovery of ${ctx.avgRecovery.toFixed(1)}/5 this week — consider an extra rest day and prioritise 7–8h sleep.`);
  if (ctx.weightTrend < -0.5) insights.push(`Weight trending down ${Math.abs(ctx.weightTrend).toFixed(1)} kg — great fat loss momentum. Ensure protein intake is high.`);
  if (insights.length < 3) insights.push("Log your weight and daily check-ins consistently for personalised AI-powered insights.");
  return insights.slice(0, 4);
}

// ─── GET /api/progress/fitness-score ─────────────────────────────────────────

export async function getFitnessScore(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;

  const [streakRows, latestCheckin, weightEntries, achievements] = await Promise.all([
    safeQuery(() => db.select().from(userStreaks).where(eq(userStreaks.userId, userId)).limit(1), []),
    safeQuery(() => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return db.select().from(dailyCheckins)
        .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, daysAgo(3))))
        .orderBy(desc(dailyCheckins.checkinDate))
        .limit(3);
    }, []),
    safeQuery(() =>
      db.select().from(weightLogs)
        .where(and(eq(weightLogs.userId, userId), gte(weightLogs.recordedAt, daysAgo(30))))
        .limit(30),
      []
    ),
    safeQuery(() =>
      db.select().from(userAchievements).where(eq(userAchievements.userId, userId)).limit(20),
      []
    ),
  ]);

  const score = computeFitnessScore({
    streak: streakRows[0]?.currentStreak ?? 0,
    inbodyScore: null,
    recentCheckin: latestCheckin[0] ?? null,
    weightEntries: weightEntries.length,
    achievementCount: achievements.length,
  });

  return res.json(score);
}

// ─── GET /api/progress/checkins/recent ───────────────────────────────────────

export async function getRecentCheckins(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const checkins = await db.select().from(dailyCheckins)
      .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, daysAgo(14))))
      .orderBy(desc(dailyCheckins.checkinDate))
      .limit(14);
    return res.json({ checkins });
  } catch (err: any) {
    logger.error({ err: err.message }, "getRecentCheckins failed");
    return res.status(500).json({ error: "Failed to fetch check-ins" });
  }
}

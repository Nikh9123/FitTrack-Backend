import { and, desc, eq, gte } from "drizzle-orm";
import {
  achievementDefinitions,
  dailyCheckins,
  db,
  userAchievements,
  weightLogs,
} from "../db";
import { findUserById } from "./auth";
import { getUnifiedHistory } from "../services/historyService";
import { getStreakDetails, getWorkoutHistory } from "../services/workoutService";

export interface TrainerContextPayload {
  profile: {
    name: string;
    goal: string | null;
    fitnessScore: number;
  };
  weightTrend: Array<{ date: string; kg: number }>;
  sleepAverage: { hours7d: number; daysLogged: number };
  calorieAverage: { kcal7d: number; daysWithMeals: number };
  waterAverage: { glasses7d: number };
  stepsAverage: { steps7d: number };
  workoutHistory: Array<{ date: string; durationMin: number; calories: number }>;
  recentAchievements: Array<{ name: string; earnedAt: string }>;
  recoveryScore: { average: number | null; energyAverage: number | null };
  consistencyScore: number;
  workoutStreak: number;
}

function computeFitnessScore(params: {
  streak: number;
  weightEntries: number;
  achievementCount: number;
  recentCheckin: { recoveryScore?: number | null } | null;
}): number {
  const streakPts = Math.min(20, Math.round((params.streak / 30) * 20));
  const recoveryPts = params.recentCheckin?.recoveryScore
    ? Math.min(20, Math.round(((params.recentCheckin.recoveryScore - 1) / 4) * 20))
    : 10;
  const logPts = Math.min(20, Math.round((Math.min(params.weightEntries, 30) / 30) * 20));
  const achievePts = Math.min(20, params.achievementCount * 4);
  return streakPts + 10 + recoveryPts + logPts + achievePts;
}

export async function buildTrainerContext(userId: string): Promise<TrainerContextPayload> {
  const [userRow, history, streakDetails, workoutSessions, achievements, recentCheckins, weightEntries] =
    await Promise.all([
      findUserById(userId),
      getUnifiedHistory(userId, "7d"),
      getStreakDetails(userId),
      getWorkoutHistory(userId, 5),
      db
        .select({
          name: achievementDefinitions.name,
          earnedAt: userAchievements.earnedAt,
        })
        .from(userAchievements)
        .innerJoin(achievementDefinitions, eq(userAchievements.achievementId, achievementDefinitions.id))
        .where(eq(userAchievements.userId, userId))
        .orderBy(desc(userAchievements.earnedAt))
        .limit(5),
      db
        .select({
          recoveryScore: dailyCheckins.recoveryScore,
          energyLevel: dailyCheckins.energyLevel,
          sleepHours: dailyCheckins.sleepHours,
        })
        .from(dailyCheckins)
        .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, daysAgo(7))))
        .orderBy(desc(dailyCheckins.checkinDate))
        .limit(7),
      db
        .select({ recordedAt: weightLogs.recordedAt, weightKg: weightLogs.weightKg })
        .from(weightLogs)
        .where(and(eq(weightLogs.userId, userId), gte(weightLogs.recordedAt, daysAgo(30))))
        .orderBy(desc(weightLogs.recordedAt))
        .limit(14),
    ]);

  const profile = userRow?.profile;
  const firstName = profile?.firstName ?? "";
  const lastName = profile?.lastName ? ` ${profile.lastName}` : "";
  const name = `${firstName}${lastName}`.trim() || "FitTrack User";

  const sleepDays = history.buckets.filter((b) => b.sleepHours > 0);
  const recoveryRows = recentCheckins.filter((c) => c.recoveryScore != null);
  const energyRows = recentCheckins.filter((c) => c.energyLevel != null);

  const fitnessScore = computeFitnessScore({
    streak: streakDetails.currentStreak,
    weightEntries: weightEntries.length,
    achievementCount: achievements.length,
    recentCheckin: recentCheckins[0] ?? null,
  });

  return {
    profile: {
      name,
      goal: profile?.fitnessGoal ?? null,
      fitnessScore,
    },
    weightTrend: weightEntries
      .map((w) => ({
        date: new Date(w.recordedAt).toISOString().split("T")[0],
        kg: parseFloat(String(w.weightKg)),
      }))
      .filter((w) => Number.isFinite(w.kg))
      .reverse(),
    sleepAverage: {
      hours7d: history.averages.sleepHours,
      daysLogged: sleepDays.length,
    },
    calorieAverage: {
      kcal7d: history.averages.caloriesConsumed,
      daysWithMeals: history.totals.daysWithMeals,
    },
    waterAverage: {
      glasses7d: history.averages.waterGlasses,
    },
    stepsAverage: {
      steps7d: history.averages.steps,
    },
    workoutHistory: workoutSessions.map((s) => ({
      date: s.completedAt ? new Date(s.completedAt).toISOString().split("T")[0] : "",
      durationMin: s.totalDuration ? Math.round(s.totalDuration / 60) : 0,
      calories: s.caloriesBurned ?? 0,
    })),
    recentAchievements: achievements.map((a) => ({
      name: a.name,
      earnedAt: new Date(a.earnedAt).toISOString().split("T")[0],
    })),
    recoveryScore: {
      average:
        recoveryRows.length > 0
          ? Math.round(
              (recoveryRows.reduce((sum, c) => sum + (c.recoveryScore ?? 0), 0) / recoveryRows.length) * 10,
            ) / 10
          : null,
      energyAverage:
        energyRows.length > 0
          ? Math.round(
              (energyRows.reduce((sum, c) => sum + (c.energyLevel ?? 0), 0) / energyRows.length) * 10,
            ) / 10
          : null,
    },
    consistencyScore: streakDetails.consistencyScore,
    workoutStreak: streakDetails.currentStreak,
  };
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

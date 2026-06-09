/**
 * Achievement criteria JSON schema (stored in achievement_definitions.criteria):
 *
 * {
 *   "metric": "workout_count" | "step_total" | "step_single_day" | "weight_lost_kg" |
 *             "streak_days" | "hydration_days" | "checkin_count" | "sleep_nights" | "pr_count",
 *   "threshold": number,
 *   "window": "lifetime" | "rolling_7d" | "rolling_30d" | "consecutive",
 *   "rarity": "common" | "rare" | "epic" | "legendary" | "mythic",
 *   "category": "workout" | "steps" | "weight" | "streak" | "hydration" | "sleep" | "strength" | "checkin",
 *   "titleUnlock": "Optional title string",
 *   "minSleepHours": 7,
 *   "minWaterMl": 2000
 * }
 */

import { and, desc, eq, gte, ne, or, isNull, sql } from "drizzle-orm";
import {
  achievementDefinitions,
  activitySummaries,
  dailyCheckins,
  db,
  personalRecords,
  userAchievements,
  userProfiles,
  userWorkoutSessions,
  waterLogs,
  weightLogs,
} from "../db";
import { getWorkoutStreakStats } from "./streakSyncService";
import { logger } from "../lib/logger";

export type AchievementTrigger =
  | "workout"
  | "steps"
  | "weight"
  | "checkin"
  | "water"
  | "meal"
  | "manual";

export type AchievementMetric =
  | "workout_count"
  | "step_total"
  | "step_single_day"
  | "weight_lost_kg"
  | "streak_days"
  | "hydration_days"
  | "checkin_count"
  | "sleep_nights"
  | "pr_count";

export interface AchievementCriteria {
  metric: AchievementMetric;
  threshold: number;
  window?: "lifetime" | "rolling_7d" | "rolling_30d" | "consecutive";
  rarity?: "common" | "rare" | "epic" | "legendary" | "mythic";
  category?: string;
  titleUnlock?: string;
  minSleepHours?: number;
  minWaterMl?: number;
}

export interface UnlockedAchievement {
  id: string;
  achievementId: string;
  name: string;
  description: string | null;
  points: number;
  rarity: string;
  category: string;
  titleUnlock: string | null;
  earnedAt: string;
}

export interface AchievementProgressItem {
  id: string;
  name: string;
  description: string | null;
  type: string;
  points: number;
  criteria: AchievementCriteria;
  rarity: string;
  category: string;
  titleUnlock: string | null;
  earned: boolean;
  earnedAt: string | null;
  currentValue: number;
  threshold: number;
  progressPercent: number;
}

export interface JourneyStage {
  id: string;
  name: string;
  minPoints: number;
  description: string;
}

export const JOURNEY_STAGES: JourneyStage[] = [
  { id: "beginner_explorer", name: "Beginner Explorer", minPoints: 0, description: "Your fitness adventure begins." },
  { id: "fitness_adventurer", name: "Fitness Adventurer", minPoints: 50, description: "You're building momentum." },
  { id: "consistency_warrior", name: "Consistency Warrior", minPoints: 150, description: "Habits are forming." },
  { id: "strength_builder", name: "Strength Builder", minPoints: 300, description: "Power and discipline combined." },
  { id: "fat_loss_specialist", name: "Fat Loss Specialist", minPoints: 500, description: "Body transformation in progress." },
  { id: "discipline_master", name: "Discipline Master", minPoints: 800, description: "Elite consistency achieved." },
  { id: "elite_athlete", name: "Elite Athlete", minPoints: 1200, description: "Top-tier dedication." },
  { id: "legend", name: "Legend", minPoints: 2000, description: "The pinnacle of the FitTrack journey." },
];

const ML_PER_GLASS = 250;
const DEFAULT_WATER_GOAL_ML = 2000;
const DEFAULT_SLEEP_HOURS = 7;

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseCriteria(raw: unknown): AchievementCriteria | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.metric !== "string" || typeof c.threshold !== "number") return null;
  return {
    metric: c.metric as AchievementMetric,
    threshold: c.threshold,
    window: (c.window as AchievementCriteria["window"]) ?? "lifetime",
    rarity: (c.rarity as AchievementCriteria["rarity"]) ?? "common",
    category: (c.category as string) ?? "workout",
    titleUnlock: (c.titleUnlock as string) ?? undefined,
    minSleepHours: (c.minSleepHours as number) ?? DEFAULT_SLEEP_HOURS,
    minWaterMl: (c.minWaterMl as number) ?? DEFAULT_WATER_GOAL_ML,
  };
}

function rarityFromPoints(points: number, criteriaRarity?: string): string {
  if (criteriaRarity) return criteriaRarity;
  if (points >= 500) return "mythic";
  if (points >= 250) return "legendary";
  if (points >= 100) return "epic";
  if (points >= 50) return "rare";
  return "common";
}

interface UserMetrics {
  workoutCount: number;
  stepTotalLifetime: number;
  stepMaxSingleDay: number;
  weightLostKg: number;
  streakDays: number;
  hydrationGoalDays: number;
  checkinCount: number;
  sleepGoalNights: number;
  prCount: number;
}

async function computeUserMetrics(userId: string): Promise<UserMetrics> {
  const [
    workoutCountRow,
    stepRows,
    weightRows,
    profileRow,
    prCountRow,
    checkinRows,
    waterRowsAll,
    sleepCheckinsAll,
    streakStats,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.userId, userId),
          sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
        ),
      ),
    db
      .select({ steps: activitySummaries.steps, summaryDate: activitySummaries.summaryDate })
      .from(activitySummaries)
      .where(eq(activitySummaries.userId, userId)),
    db
      .select({ weightKg: weightLogs.weightKg, recordedAt: weightLogs.recordedAt })
      .from(weightLogs)
      .where(
        and(
          eq(weightLogs.userId, userId),
          or(isNull(weightLogs.notes), ne(weightLogs.notes, "fittrack_demo_seed")),
        ),
      )
      .orderBy(desc(weightLogs.recordedAt)),
    db
      .select({ weightKg: userProfiles.weightKg })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
      .from(personalRecords)
      .where(eq(personalRecords.userId, userId)),
    db
      .select({ checkinDate: dailyCheckins.checkinDate })
      .from(dailyCheckins)
      .where(eq(dailyCheckins.userId, userId)),
    db
      .select({ logDate: waterLogs.logDate, amountMl: waterLogs.amountMl })
      .from(waterLogs)
      .where(eq(waterLogs.userId, userId)),
    db
      .select({ checkinDate: dailyCheckins.checkinDate, sleepHours: dailyCheckins.sleepHours })
      .from(dailyCheckins)
      .where(eq(dailyCheckins.userId, userId)),
    getWorkoutStreakStats(userId),
  ]);

  const stepTotalLifetime = stepRows.reduce((s, r) => s + (r.steps ?? 0), 0);
  const stepMaxSingleDay = stepRows.reduce((m, r) => Math.max(m, r.steps ?? 0), 0);

  let weightLostKg = 0;
  if (weightRows.length >= 1) {
    const latest = parseFloat(String(weightRows[0].weightKg));
    const baselineProfile = profileRow[0]?.weightKg
      ? parseFloat(String(profileRow[0].weightKg))
      : null;
    const oldest = weightRows.length > 1
      ? parseFloat(String(weightRows[weightRows.length - 1].weightKg))
      : baselineProfile;
    if (Number.isFinite(latest) && oldest != null && Number.isFinite(oldest) && oldest > latest) {
      weightLostKg = Math.round((oldest - latest) * 10) / 10;
    }
  }

  const waterByDay = new Map<string, number>();
  for (const row of waterRowsAll) {
    const key = toLocalDateKey(new Date(row.logDate));
    waterByDay.set(key, (waterByDay.get(key) ?? 0) + (row.amountMl ?? 0));
  }
  let hydrationGoalDays = 0;
  for (const ml of waterByDay.values()) {
    if (ml >= DEFAULT_WATER_GOAL_ML) hydrationGoalDays++;
  }

  let sleepGoalNights = 0;
  for (const row of sleepCheckinsAll) {
    const hours = parseFloat(String(row.sleepHours ?? 0));
    if (hours >= DEFAULT_SLEEP_HOURS) sleepGoalNights++;
  }

  return {
    workoutCount: workoutCountRow[0]?.count ?? 0,
    stepTotalLifetime,
    stepMaxSingleDay,
    weightLostKg,
    streakDays: streakStats.currentStreak,
    hydrationGoalDays,
    checkinCount: checkinRows.length,
    sleepGoalNights,
    prCount: prCountRow[0]?.count ?? 0,
  };
}

function metricValue(metrics: UserMetrics, criteria: AchievementCriteria): number {
  switch (criteria.metric) {
    case "workout_count":
      return metrics.workoutCount;
    case "step_total":
      return metrics.stepTotalLifetime;
    case "step_single_day":
      return metrics.stepMaxSingleDay;
    case "weight_lost_kg":
      return metrics.weightLostKg;
    case "streak_days":
      return metrics.streakDays;
    case "hydration_days":
      return criteria.window === "consecutive"
        ? metrics.hydrationGoalDays
        : metrics.hydrationGoalDays;
    case "checkin_count":
      return metrics.checkinCount;
    case "sleep_nights":
      return metrics.sleepGoalNights;
    case "pr_count":
      return metrics.prCount;
    default:
      return 0;
  }
}

function triggersForMetric(metric: AchievementMetric): AchievementTrigger[] {
  switch (metric) {
    case "workout_count":
    case "streak_days":
      return ["workout"];
    case "step_total":
    case "step_single_day":
      return ["steps"];
    case "weight_lost_kg":
      return ["weight"];
    case "hydration_days":
      return ["water"];
    case "checkin_count":
      return ["checkin"];
    case "sleep_nights":
      return ["checkin"];
    case "pr_count":
      return ["workout"];
    default:
      return ["manual"];
  }
}

function shouldEvaluateDefinition(criteria: AchievementCriteria, trigger: AchievementTrigger): boolean {
  if (trigger === "manual") return true;
  return triggersForMetric(criteria.metric).includes(trigger);
}

async function getEarnedAchievementIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ achievementId: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  return new Set(rows.map((r) => r.achievementId));
}

export async function evaluateAchievements(
  userId: string,
  trigger: AchievementTrigger = "manual",
): Promise<UnlockedAchievement[]> {
  try {
    const [definitions, earnedIds, metrics] = await Promise.all([
      db
        .select()
        .from(achievementDefinitions)
        .where(eq(achievementDefinitions.isActive, true)),
      getEarnedAchievementIds(userId),
      computeUserMetrics(userId),
    ]);

    const newlyUnlocked: UnlockedAchievement[] = [];

    for (const def of definitions) {
      if (earnedIds.has(def.id)) continue;

      const criteria = parseCriteria(def.criteria);
      if (!criteria) continue;
      if (!shouldEvaluateDefinition(criteria, trigger)) continue;

      const current = metricValue(metrics, criteria);
      if (current < criteria.threshold) continue;

      const [inserted] = await db
        .insert(userAchievements)
        .values({
          userId,
          achievementId: def.id,
          meta: {
            valueAtUnlock: current,
            trigger,
            rarity: criteria.rarity ?? rarityFromPoints(def.points),
          },
        })
        .returning();

      if (!inserted) continue;

      earnedIds.add(def.id);
      newlyUnlocked.push({
        id: inserted.id,
        achievementId: def.id,
        name: def.name,
        description: def.description,
        points: def.points,
        rarity: criteria.rarity ?? rarityFromPoints(def.points),
        category: criteria.category ?? def.type,
        titleUnlock: criteria.titleUnlock ?? null,
        earnedAt: inserted.earnedAt.toISOString(),
      });

      logger.info({ userId, achievement: def.name, trigger }, "Achievement unlocked");
    }

    return newlyUnlocked;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, userId, trigger }, "evaluateAchievements failed");
    return [];
  }
}

export async function getAchievementProgress(userId: string): Promise<{
  achievements: AchievementProgressItem[];
  totalPoints: number;
  earnedCount: number;
}> {
  const [definitions, earnedRows, metrics] = await Promise.all([
    db
      .select()
      .from(achievementDefinitions)
      .where(eq(achievementDefinitions.isActive, true))
      .orderBy(achievementDefinitions.points),
    db
      .select({
        achievementId: userAchievements.achievementId,
        earnedAt: userAchievements.earnedAt,
      })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
    computeUserMetrics(userId),
  ]);

  const earnedMap = new Map(earnedRows.map((r) => [r.achievementId, r.earnedAt]));

  const achievements: AchievementProgressItem[] = definitions.map((def) => {
    const criteria = parseCriteria(def.criteria) ?? {
      metric: "workout_count" as AchievementMetric,
      threshold: 1,
      category: def.type,
      rarity: "common" as const,
    };
    const currentValue = metricValue(metrics, criteria);
    const threshold = criteria.threshold;
    const progressPercent = threshold > 0 ? Math.min(100, Math.round((currentValue / threshold) * 100)) : 0;
    const earnedAt = earnedMap.get(def.id);

    return {
      id: def.id,
      name: def.name,
      description: def.description,
      type: def.type,
      points: def.points,
      criteria,
      rarity: criteria.rarity ?? rarityFromPoints(def.points),
      category: criteria.category ?? def.type,
      titleUnlock: criteria.titleUnlock ?? null,
      earned: earnedAt != null,
      earnedAt: earnedAt ? earnedAt.toISOString() : null,
      currentValue,
      threshold,
      progressPercent,
    };
  });

  const earnedItems = achievements.filter((a) => a.earned);
  const totalPoints = earnedItems.reduce((s, a) => s + a.points, 0);

  return {
    achievements,
    totalPoints,
    earnedCount: earnedItems.length,
  };
}

export async function getJourneyProgress(userId: string): Promise<{
  stages: Array<JourneyStage & { unlocked: boolean; current: boolean }>;
  currentStage: JourneyStage;
  nextStage: JourneyStage | null;
  totalPoints: number;
  pointsToNext: number | null;
  earnedTitles: string[];
  equippedTitle: string | null;
}> {
  const { totalPoints, achievements } = await getAchievementProgress(userId);

  const earnedTitles = achievements
    .filter((a) => a.earned && a.titleUnlock)
    .map((a) => a.titleUnlock as string);

  let currentStageIndex = 0;
  for (let i = JOURNEY_STAGES.length - 1; i >= 0; i--) {
    if (totalPoints >= JOURNEY_STAGES[i].minPoints) {
      currentStageIndex = i;
      break;
    }
  }

  const currentStage = JOURNEY_STAGES[currentStageIndex];
  const nextStage = currentStageIndex < JOURNEY_STAGES.length - 1 ? JOURNEY_STAGES[currentStageIndex + 1] : null;
  const pointsToNext = nextStage ? nextStage.minPoints - totalPoints : null;

  const stages = JOURNEY_STAGES.map((stage, i) => ({
    ...stage,
    unlocked: totalPoints >= stage.minPoints,
    current: i === currentStageIndex,
  }));

  const [profile] = await db
    .select({ onboardingData: userProfiles.onboardingData })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const onboarding = (profile?.onboardingData ?? {}) as Record<string, unknown>;
  const journey = (onboarding.fitnessJourney ?? {}) as Record<string, unknown>;
  const equippedTitle = (journey.equippedTitle as string) ?? earnedTitles[0] ?? null;

  return {
    stages,
    currentStage,
    nextStage,
    totalPoints,
    pointsToNext,
    earnedTitles,
    equippedTitle,
  };
}

export async function syncHydrationStreak(userId: string): Promise<number> {
  const since30 = daysAgo(30);
  const rows = await db
    .select({ logDate: waterLogs.logDate, amountMl: waterLogs.amountMl })
    .from(waterLogs)
    .where(and(eq(waterLogs.userId, userId), gte(waterLogs.logDate, since30)));

  const byDay = new Map<string, number>();
  for (const row of rows) {
    const key = toLocalDateKey(new Date(row.logDate));
    byDay.set(key, (byDay.get(key) ?? 0) + (row.amountMl ?? 0));
  }

  const goalDays = [...byDay.entries()]
    .filter(([, ml]) => ml >= DEFAULT_WATER_GOAL_ML)
    .map(([d]) => d)
    .sort((a, b) => b.localeCompare(a));

  let streak = 0;
  if (goalDays.length > 0) {
    const today = toLocalDateKey(new Date());
    const yesterday = toLocalDateKey(daysAgo(1));
    if (goalDays[0] === today || goalDays[0] === yesterday) {
      streak = 1;
      let expected = new Date(`${goalDays[0]}T12:00:00`);
      expected.setDate(expected.getDate() - 1);
      for (let i = 1; i < goalDays.length; i++) {
        if (goalDays[i] === toLocalDateKey(expected)) {
          streak++;
          expected.setDate(expected.getDate() - 1);
        } else break;
      }
    }
  }

  const { upsertUserStreak } = await import("./streakSyncService");
  await upsertUserStreak(userId, "hydration", streak, streak);
  return streak;
}

export async function syncCheckinStreak(userId: string): Promise<number> {
  const rows = await db
    .select({ checkinDate: dailyCheckins.checkinDate })
    .from(dailyCheckins)
    .where(eq(dailyCheckins.userId, userId))
    .orderBy(desc(dailyCheckins.checkinDate));

  const dates = [...new Set(rows.map((r) => toLocalDateKey(new Date(r.checkinDate))))].sort(
    (a, b) => b.localeCompare(a),
  );

  let streak = 0;
  if (dates.length > 0) {
    const today = toLocalDateKey(new Date());
    const yesterday = toLocalDateKey(daysAgo(1));
    if (dates[0] === today || dates[0] === yesterday) {
      streak = 1;
      let expected = new Date(`${dates[0]}T12:00:00`);
      expected.setDate(expected.getDate() - 1);
      for (let i = 1; i < dates.length; i++) {
        if (dates[i] === toLocalDateKey(expected)) {
          streak++;
          expected.setDate(expected.getDate() - 1);
        } else break;
      }
    }
  }

  const { upsertUserStreak } = await import("./streakSyncService");
  await upsertUserStreak(userId, "checkin", streak, streak);
  return streak;
}

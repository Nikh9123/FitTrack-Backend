import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  activityInsights,
  aiPlanRequests,
  aiPlanResponses,
  db,
  inbodyReports,
  nutritionTargets,
  userAchievements,
  userWorkoutExercises,
  userWorkoutPlans,
  userWorkoutSessions,
} from "../db";
import { buildTrainerContext } from "../lib/ai-trainer-context";
import { generateDailyDigestNarrative, generateMonthlyReviewNarrative, generateWeeklyReviewNarrative } from "../lib/ai-coach-review";
import { findUserById } from "../lib/auth";
import { logger } from "../lib/logger";
import type { UnlockedAchievement } from "./achievementService";
import { getAchievementProgress } from "./achievementService";
import { evaluateGoal, recommendNextWeekGoals } from "./goalRecommendationEngine";
import { buildCoachForecasts, buildStrengthTrends } from "./forecastService";
import { getHistoryForDateRange, getHistoryInsights, getUnifiedHistory } from "./historyService";
import type {
  CoachReviewContext,
  DailyActivityDay,
  DailyDigestContext,
  DailyDigestResponse,
  DataSourceConsidered,
  MonthlyReviewResponse,
  SavedCoachReportSummary,
  WeeklyReviewResponse,
} from "./coachReviewTypes";
import { getStreakDetails } from "./workoutService";

const DEFAULT_WATER_GOAL_ML = 2000;
const SLEEP_GOAL_HOURS = 7;

// ─── Week / month helpers ─────────────────────────────────────────────────────

export function getISOWeekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function getCalendarWeekBounds(refDate = new Date()): {
  start: Date;
  end: Date;
  weekKey: string;
  weekLabel: string;
} {
  const d = new Date(refDate);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + mondayOffset);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  const fmt = (dt: Date) =>
    dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return {
    start,
    end,
    weekKey: getISOWeekKey(start),
    weekLabel: `${fmt(start).replace(/, \d{4}$/, "")} – ${fmt(end)}`,
  };
}

function parseWeekKey(weekKey: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return new Date();
  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - day + 1 + (week - 1) * 7);
  monday.setHours(12, 0, 0, 0);
  return monday;
}

function getWeekBoundsForKey(weekKey: string) {
  return getCalendarWeekBounds(parseWeekKey(weekKey));
}

function getMonthBounds(monthKey: string): { start: Date; end: Date; monthLabel: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const now = new Date();
  const year = match ? parseInt(match[1], 10) : now.getFullYear();
  const month = match ? parseInt(match[2], 10) - 1 : now.getMonth();
  const start = new Date(year, month, 1, 0, 0, 0, 0);
  const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
  const monthLabel = start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { start, end, monthLabel };
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const m = today.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < born.getDate())) age -= 1;
  return age;
}

async function getPlannedWorkoutsPerWeek(userId: string): Promise<number> {
  const [plan] = await db
    .select({ id: userWorkoutPlans.id })
    .from(userWorkoutPlans)
    .where(eq(userWorkoutPlans.userId, userId))
    .orderBy(desc(userWorkoutPlans.createdAt))
    .limit(1);

  if (!plan) return 4;

  const days = await db
    .selectDistinct({ dayName: userWorkoutExercises.dayName })
    .from(userWorkoutExercises)
    .where(eq(userWorkoutExercises.workoutPlanId, plan.id));

  return Math.max(days.length, 3);
}

async function countCompletedWorkouts(userId: string, start: Date, end: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
        gte(userWorkoutSessions.completedAt, start),
        lte(userWorkoutSessions.completedAt, end),
      ),
    );
  return row?.count ?? 0;
}

async function getWorkoutDatesInRange(userId: string, start: Date, end: Date): Promise<Set<string>> {
  const rows = await db
    .select({ completedAt: userWorkoutSessions.completedAt })
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
        gte(userWorkoutSessions.completedAt, start),
        lte(userWorkoutSessions.completedAt, end),
      ),
    );

  return new Set(
    rows
      .filter((r) => r.completedAt)
      .map((r) => toLocalDateKey(new Date(r.completedAt!))),
  );
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function buildDailyBreakdown(
  history: Awaited<ReturnType<typeof getHistoryForDateRange>>,
  workoutDates: Set<string>,
): DailyActivityDay[] {
  return history.buckets.map((b) => {
    const activitiesLogged: string[] = [];
    if (b.steps > 0) activitiesLogged.push(`Steps (${b.steps.toLocaleString()})`);
    if (b.caloriesBurned > 0) activitiesLogged.push(`Burn (${b.caloriesBurned} kcal)`);
    if (b.caloriesConsumed > 0) activitiesLogged.push(`Meals (${Math.round(b.caloriesConsumed)} kcal)`);
    if (b.proteinG > 0) activitiesLogged.push(`Protein (${Math.round(b.proteinG)}g)`);
    if (b.waterGlasses > 0) activitiesLogged.push(`Water (${b.waterGlasses} glasses)`);
    if (b.sleepHours > 0) activitiesLogged.push(`Sleep (${b.sleepHours}h)`);
    if (b.weightKg != null) activitiesLogged.push(`Weight (${b.weightKg} kg)`);
    if (workoutDates.has(b.date)) activitiesLogged.push("Workout completed");

    return {
      date: b.date,
      dayLabel: formatDayLabel(b.date),
      steps: b.steps,
      caloriesBurned: b.caloriesBurned,
      caloriesConsumed: b.caloriesConsumed,
      waterGlasses: b.waterGlasses,
      sleepHours: b.sleepHours,
      weightKg: b.weightKg,
      workoutCompleted: workoutDates.has(b.date),
      activitiesLogged,
    };
  });
}

export function getDataSourcesConsidered(): DataSourceConsidered[] {
  return [
    {
      id: "activity_summaries",
      label: "Activity & steps",
      metrics: ["Daily steps", "Calories burned", "Sleep minutes"],
      description: "Synced from phone sensors, Google Fit, Apple Health, or manual logs.",
    },
    {
      id: "diet_logs",
      label: "Nutrition",
      metrics: ["Calories consumed", "Protein", "Carbs", "Fat"],
      description: "Every meal you log in the Diet tab.",
    },
    {
      id: "water_logs",
      label: "Hydration",
      metrics: ["Water intake (ml / glasses)"],
      description: "Water logs compared to your daily hydration goal.",
    },
    {
      id: "weight_logs",
      label: "Scale weight",
      metrics: ["Weight trend", "Weekly change"],
      description: "Manual scale entries (excludes demo seed data).",
    },
    {
      id: "inbody_reports",
      label: "InBody scans",
      metrics: ["Body fat %", "Muscle mass", "BMR"],
      description: "Uploaded InBody reports and AI analysis when available.",
    },
    {
      id: "user_workout_sessions",
      label: "Workouts",
      metrics: ["Sessions completed", "Consistency %", "Calories burned"],
      description: "Completed workout sessions vs your plan schedule.",
    },
    {
      id: "daily_checkins",
      label: "Daily check-ins",
      metrics: ["Energy", "Sleep", "Recovery score", "Soreness"],
      description: "Morning wellness check-ins on the Progress tab.",
    },
    {
      id: "achievements",
      label: "Achievements",
      metrics: ["Badges unlocked this week", "Total points"],
      description: "Achievement engine evaluated from real activity hooks.",
    },
    {
      id: "user_profiles_goals",
      label: "Profile & goals",
      metrics: ["Fitness goal", "Age", "Gender", "Targets"],
      description: "Your profile intent plus active goals and nutrition targets.",
    },
    {
      id: "ai_narrative",
      label: "AI narrative (Groq)",
      metrics: ["Summary", "Insights", "Next-week focus"],
      description: "AI only narrates pre-computed numbers above — it never invents metrics.",
    },
  ];
}

async function attachWeeklyReviewDetails(
  userId: string,
  start: Date,
  end: Date,
  review: WeeklyReviewResponse,
  periodKey: string,
): Promise<WeeklyReviewResponse> {
  const [history, workoutDates] = await Promise.all([
    getHistoryForDateRange(userId, start, end),
    getWorkoutDatesInRange(userId, start, end),
  ]);
  const dailyBreakdown = buildDailyBreakdown(history, workoutDates);
  const activeDaysCount = dailyBreakdown.filter((d) => d.activitiesLogged.length > 0).length;
  const forecasts = await buildCoachForecasts(userId, review.summary.weight.current);

  const enriched: WeeklyReviewResponse = {
    ...review,
    forecasts,
    transformationTimeline: forecasts.transformationTimeline,
    dailyBreakdown,
    dataSourcesConsidered: getDataSourcesConsidered(),
    activeDaysCount,
    saved: true,
    cached: true,
  };

  const needsSync =
    !review.dailyBreakdown?.length ||
    !review.forecasts?.weightDetails?.length ||
    !review.dataSourcesConsidered?.length;

  let reportId = review.reportId ?? null;
  let savedAt = review.savedAt ?? null;

  if (needsSync) {
    const meta = await upsertPersistReview(userId, "coach_weekly_review", periodKey, enriched);
    reportId = meta.reportId;
    savedAt = meta.savedAt;
  } else if (!reportId) {
    const meta = await findCachedReviewMeta(userId, "coach_weekly_review", periodKey);
    reportId = meta?.reportId ?? null;
    savedAt = meta?.savedAt ?? null;
  }

  return { ...enriched, reportId, savedAt };
}

function countGoalDays(
  buckets: Array<{ waterMl?: number; sleepHours: number }>,
  type: "water" | "sleep",
  waterGoalMl = DEFAULT_WATER_GOAL_ML,
): number {
  if (type === "water") {
    return buckets.filter((b) => (b.waterMl ?? 0) >= waterGoalMl).length;
  }
  return buckets.filter((b) => b.sleepHours >= SLEEP_GOAL_HOURS).length;
}

function computeDrivers(
  history: Awaited<ReturnType<typeof getHistoryForDateRange>>,
): { positive: string[]; negative: string[] } {
  const positive: string[] = [];
  const negative: string[] = [];

  if (history.totals.daysWithSteps >= 5) positive.push("Regular step tracking");
  else negative.push("Low step logging this week");

  if (history.totals.daysWithMeals >= 5) positive.push("Consistent meal logging");
  else negative.push("Incomplete nutrition logs");

  if (history.averages.sleepHours >= 7) positive.push("Solid sleep average");
  else if (history.averages.sleepHours > 0) negative.push("Sleep below 7h average");

  return { positive, negative };
}

async function buildSummaryFromHistory(
  userId: string,
  start: Date,
  end: Date,
  overallScore: number,
  consistencyPct: number,
) {
  const history = await getHistoryForDateRange(userId, start, end);
  const planned = await getPlannedWorkoutsPerWeek(userId);
  const completed = await countCompletedWorkouts(userId, start, end);

  const weightBuckets = history.buckets.filter((b) => b.weightKg != null);
  const startWeight = weightBuckets[0]?.weightKg ?? null;
  const endWeight = weightBuckets[weightBuckets.length - 1]?.weightKg ?? startWeight;
  const change =
    startWeight != null && endWeight != null ? Math.round((endWeight - startWeight) * 10) / 10 : 0;

  const waterGoalDays = countGoalDays(history.buckets, "water");
  const sleepGoalDays = countGoalDays(history.buckets, "sleep");

  const avgDeficit =
    history.days > 0
      ? Math.max(0, (history.totals.caloriesBurned - history.totals.caloriesConsumed) / history.days)
      : 0;

  return {
    history,
    summary: {
      overallScore,
      weight: { start: startWeight, end: endWeight, change },
      steps: history.totals.steps,
      caloriesBurned: history.totals.caloriesBurned,
      caloriesConsumed: history.totals.caloriesConsumed,
      workouts: {
        completed,
        planned,
        consistencyPct,
      },
      waterGoalDays,
      sleepGoalDays,
      proteinAvgG: history.averages.proteinG,
    },
    avgDeficit,
  };
}

export async function buildReviewContext(
  userId: string,
  opts: { weekKey?: string; label?: "weekly" | "monthly"; rangeStart?: Date; rangeEnd?: Date } = {},
): Promise<CoachReviewContext> {
  const bounds =
    opts.rangeStart && opts.rangeEnd
      ? {
          start: opts.rangeStart,
          end: opts.rangeEnd,
          weekKey: opts.weekKey ?? getISOWeekKey(opts.rangeStart),
          weekLabel: "",
        }
      : opts.weekKey
        ? getWeekBoundsForKey(opts.weekKey)
        : getCalendarWeekBounds();

  const label = opts.label ?? "weekly";
  const [trainerCtx, streakDetails, achievementData, latestInbody] = await Promise.all([
    buildTrainerContext(userId),
    getStreakDetails(userId),
    getAchievementProgress(userId),
    db
      .select({ extractedMetrics: inbodyReports.extractedMetrics })
      .from(inbodyReports)
      .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1),
  ]);

  const userRow = await findUserById(userId);
  const profile = userRow?.profile;

  const { history, summary, avgDeficit } = await buildSummaryFromHistory(
    userId,
    bounds.start,
    bounds.end,
    trainerCtx.profile.fitnessScore,
    streakDetails.consistencyScore,
  );

  const goal = await evaluateGoal({
    userId,
    buckets: history.buckets,
    workoutCompleted: summary.workouts.completed,
    plannedWorkouts: summary.workouts.planned,
  });

  const nextWeekGoals = await recommendNextWeekGoals({
    userId,
    buckets: history.buckets,
    workoutCompleted: summary.workouts.completed,
    plannedWorkouts: summary.workouts.planned,
  });

  const unlockedThisPeriod = await getAchievementsInRange(userId, bounds.start, bounds.end);
  const drivers = computeDrivers(history);

  const weightTrend: CoachReviewContext["trends"]["weight"] =
    summary.weight.change < -0.2 ? "down" : summary.weight.change > 0.2 ? "up" : "stable";

  const m = (latestInbody[0]?.extractedMetrics ?? {}) as Record<string, string>;
  const [forecasts, strengthTrends] = await Promise.all([
    buildCoachForecasts(userId, summary.weight.end),
    buildStrengthTrends(userId),
  ]);

  const insights = await getHistoryInsights(userId, "7d");
  if (insights.some((i) => i.trend === "up" && i.metric === "steps")) {
    drivers.positive.push("Step count trending up");
  }
  if (insights.some((i) => i.trend === "down" && i.metric === "sleep")) {
    drivers.negative.push("Sleep trending down");
  }

  return {
    period: {
      start: bounds.start.toISOString().split("T")[0],
      end: bounds.end.toISOString().split("T")[0],
      label,
      weekKey: bounds.weekKey,
    },
    profile: {
      name: trainerCtx.profile.name,
      age: ageFromDob(profile?.dateOfBirth ?? null),
      gender: profile?.gender ?? null,
      heightCm: profile?.heightCm ? parseFloat(String(profile.heightCm)) : null,
      weightKg: summary.weight.end ?? (profile?.weightKg ? parseFloat(String(profile.weightKg)) : null),
      fitnessGoal: profile?.fitnessGoal ?? null,
    },
    summary,
    trends: {
      weight: weightTrend,
      fatLoss: m.bodyFat ? parseFloat(m.bodyFat) : null,
      muscle: m.skeletalMuscleMass ? parseFloat(m.skeletalMuscleMass) : null,
      strength: strengthTrends,
      recovery: trainerCtx.recoveryScore.average ?? 0,
      consistency: streakDetails.consistencyScore,
    },
    goal,
    nextWeekGoals,
    achievements: {
      unlockedThisPeriod,
      totalPoints: achievementData.totalPoints,
    },
    drivers,
    forecasts,
  };
}

async function getAchievementsInRange(
  userId: string,
  start: Date,
  end: Date,
): Promise<UnlockedAchievement[]> {
  const rows = await db
    .select({
      id: userAchievements.id,
      achievementId: userAchievements.achievementId,
      earnedAt: userAchievements.earnedAt,
      meta: userAchievements.meta,
    })
    .from(userAchievements)
    .where(
      and(
        eq(userAchievements.userId, userId),
        gte(userAchievements.earnedAt, start),
        lte(userAchievements.earnedAt, end),
      ),
    );

  if (!rows.length) return [];

  const progress = await getAchievementProgress(userId);
  const byId = new Map(progress.achievements.map((a) => [a.id, a]));

  return rows
    .map((r) => {
      const def = byId.get(r.achievementId);
      if (!def) return null;
      return {
        id: r.id,
        achievementId: r.achievementId,
        name: def.name,
        description: def.description,
        points: def.points,
        rarity: def.rarity,
        category: def.category,
        titleUnlock: def.titleUnlock,
        earnedAt: new Date(r.earnedAt).toISOString(),
      };
    })
    .filter((x): x is UnlockedAchievement => x != null);
}

type CoachPersistRequestType = "coach_weekly_review" | "coach_monthly_review" | "coach_daily_digest";

async function findCachedReviewMeta(
  userId: string,
  requestType: CoachPersistRequestType,
  periodKey: string,
): Promise<{ reportId: string; savedAt: string; responsePayload: unknown } | null> {
  const rows = await db
    .select({
      reportId: aiPlanRequests.id,
      savedAt: aiPlanRequests.completedAt,
      responsePayload: aiPlanResponses.responsePayload,
    })
    .from(aiPlanRequests)
    .innerJoin(aiPlanResponses, eq(aiPlanResponses.requestId, aiPlanRequests.id))
    .where(
      and(
        eq(aiPlanRequests.userId, userId),
        eq(aiPlanRequests.requestType, requestType),
        eq(aiPlanRequests.status, "completed"),
        sql`${aiPlanRequests.inputPayload}->>'periodKey' = ${periodKey}`,
      ),
    )
    .orderBy(desc(aiPlanRequests.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row?.responsePayload || typeof row.responsePayload !== "object") return null;
  return {
    reportId: row.reportId,
    savedAt: row.savedAt ? new Date(row.savedAt).toISOString() : new Date().toISOString(),
    responsePayload: row.responsePayload,
  };
}

async function findCachedReview(
  userId: string,
  requestType: "coach_weekly_review" | "coach_monthly_review",
  periodKey: string,
): Promise<(WeeklyReviewResponse | MonthlyReviewResponse) | null> {
  const meta = await findCachedReviewMeta(userId, requestType, periodKey);
  if (!meta) return null;
  return {
    ...(meta.responsePayload as object),
    cached: true,
    saved: true,
    reportId: meta.reportId,
    savedAt: meta.savedAt,
  } as WeeklyReviewResponse | MonthlyReviewResponse;
}

async function deleteReviewsForPeriod(
  userId: string,
  requestType: CoachPersistRequestType,
  periodKey: string,
) {
  const existing = await db
    .select({ id: aiPlanRequests.id })
    .from(aiPlanRequests)
    .where(
      and(
        eq(aiPlanRequests.userId, userId),
        eq(aiPlanRequests.requestType, requestType),
        sql`${aiPlanRequests.inputPayload}->>'periodKey' = ${periodKey}`,
      ),
    );

  if (!existing.length) return;
  await db.delete(aiPlanRequests).where(
    inArray(
      aiPlanRequests.id,
      existing.map((r) => r.id),
    ),
  );
}

async function upsertPersistReview(
  userId: string,
  requestType: CoachPersistRequestType,
  periodKey: string,
  response: WeeklyReviewResponse | MonthlyReviewResponse | DailyDigestResponse,
  context?: CoachReviewContext | DailyDigestContext | null,
) {
  await deleteReviewsForPeriod(userId, requestType, periodKey);

  const now = new Date();
  const payload = {
    ...response,
    saved: true,
    cached: false,
    generatedAt: response.generatedAt ?? now.toISOString(),
  };

  const [request] = await db
    .insert(aiPlanRequests)
    .values({
      userId,
      requestType,
      status: "completed",
      inputPayload: { periodKey, context: context ?? null },
      completedAt: now,
    })
    .returning();

  await db.insert(aiPlanResponses).values({
    requestId: request.id,
    responsePayload: payload,
  });

  return { reportId: request.id, savedAt: now.toISOString() };
}

/** @deprecated use upsertPersistReview */
async function persistReview(
  userId: string,
  requestType: "coach_weekly_review" | "coach_monthly_review",
  periodKey: string,
  context: CoachReviewContext,
  response: WeeklyReviewResponse | MonthlyReviewResponse,
) {
  return upsertPersistReview(userId, requestType, periodKey, response, context);
}

function contextToWeeklyResponse(
  context: CoachReviewContext,
  narrative: Awaited<ReturnType<typeof generateWeeklyReviewNarrative>>,
  weekLabel: string,
  cached: boolean,
  dailyBreakdown: DailyActivityDay[],
  activeDaysCount: number,
): WeeklyReviewResponse {
  const { summary } = context;
  return {
    weekKey: context.period.weekKey,
    weekLabel,
    overallScore: summary.overallScore,
    summary: {
      weight: { current: summary.weight.end, change: summary.weight.change },
      steps: summary.steps,
      caloriesBurned: summary.caloriesBurned,
      caloriesConsumed: summary.caloriesConsumed,
      workouts: `${summary.workouts.completed}/${summary.workouts.planned}`,
      waterGoalDays: `${summary.waterGoalDays}/7`,
      sleepGoalDays: `${summary.sleepGoalDays}/7`,
      consistency: summary.workouts.consistencyPct,
      proteinAvgG: summary.proteinAvgG,
    },
    aiSummary: narrative.aiSummary,
    progressAnalysis: narrative.progressAnalysis,
    goalEvaluation: context.goal,
    nextWeekGoals: context.nextWeekGoals,
    drivers: narrative.drivers,
    coachInsights: narrative.coachInsights,
    forecasts: context.forecasts,
    achievementsUnlocked: context.achievements.unlockedThisPeriod,
    generatedAt: new Date().toISOString(),
    cached,
    narrativeSource: narrative.source,
    nextWeekFocus: narrative.nextWeekFocus,
    dailyBreakdown,
    dataSourcesConsidered: getDataSourcesConsidered(),
    activeDaysCount,
    transformationTimeline: context.forecasts.transformationTimeline,
    saved: false,
    reportId: null,
    savedAt: null,
  };
}

export async function generateWeeklyReview(
  userId: string,
  weekKey?: string,
  force = false,
): Promise<WeeklyReviewResponse> {
  const bounds = weekKey ? getWeekBoundsForKey(weekKey) : getCalendarWeekBounds();
  const key = bounds.weekKey;

  if (!force) {
    const cached = await findCachedReview(userId, "coach_weekly_review", key);
    if (cached && "weekKey" in cached) {
      return attachWeeklyReviewDetails(userId, bounds.start, bounds.end, cached as WeeklyReviewResponse, key);
    }
  }

  const context = await buildReviewContext(userId, { weekKey: key });
  const narrative = await generateWeeklyReviewNarrative(context);

  const history = await getHistoryForDateRange(userId, bounds.start, bounds.end);
  const workoutDates = await getWorkoutDatesInRange(userId, bounds.start, bounds.end);
  const dailyBreakdown = buildDailyBreakdown(history, workoutDates);
  const activeDaysCount = dailyBreakdown.filter((d) => d.activitiesLogged.length > 0).length;

  const response = contextToWeeklyResponse(
    context,
    narrative,
    bounds.weekLabel,
    false,
    dailyBreakdown,
    activeDaysCount,
  );

  const meta = await persistReview(userId, "coach_weekly_review", key, context, response);
  return { ...response, saved: true, reportId: meta.reportId, savedAt: meta.savedAt };
}

export async function getWeeklyReview(userId: string, weekKey?: string): Promise<WeeklyReviewResponse> {
  const bounds = weekKey ? getWeekBoundsForKey(weekKey) : getCalendarWeekBounds();
  const cached = await findCachedReview(userId, "coach_weekly_review", bounds.weekKey);
  if (cached && "weekKey" in cached) {
    return attachWeeklyReviewDetails(userId, bounds.start, bounds.end, cached as WeeklyReviewResponse, bounds.weekKey);
  }
  return generateWeeklyReview(userId, bounds.weekKey, false);
}

async function attachMonthlyReportDetails(
  userId: string,
  review: MonthlyReviewResponse,
  periodKey: string,
): Promise<MonthlyReviewResponse> {
  const forecasts = await buildCoachForecasts(userId, review.summary?.currentWeightKg ?? null);
  const enriched: MonthlyReviewResponse = {
    ...review,
    summary: {
      ...review.summary,
      currentWeightKg: review.summary?.currentWeightKg ?? null,
    },
    progressAnalysis: review.progressAnalysis ?? {
      weight: "",
      activity: "",
      nutrition: "",
      recovery: "",
    },
    nextMonthFocus: review.nextMonthFocus ?? "",
    personalRecords:
      review.personalRecords ??
      forecasts.strength.map((s) => ({
        exercise: s.exercise,
        current: s.current,
        predicted: s.predicted,
        weeks: s.weeks,
      })),
    forecasts,
    transformationTimeline: forecasts.transformationTimeline,
    saved: true,
    cached: true,
  };

  const needsSync = !review.forecasts?.weightDetails?.length || !review.transformationTimeline?.length;
  let reportId = review.reportId ?? null;
  let savedAt = review.savedAt ?? null;

  if (needsSync) {
    const meta = await upsertPersistReview(userId, "coach_monthly_review", periodKey, enriched);
    reportId = meta.reportId;
    savedAt = meta.savedAt;
  } else if (!reportId) {
    const meta = await findCachedReviewMeta(userId, "coach_monthly_review", periodKey);
    reportId = meta?.reportId ?? null;
    savedAt = meta?.savedAt ?? null;
  }

  return { ...enriched, reportId, savedAt };
}

export async function generateMonthlyReport(
  userId: string,
  monthKey?: string,
  force = false,
): Promise<MonthlyReviewResponse> {
  const key = monthKey ?? getCurrentMonthKey();
  const { start, end, monthLabel } = getMonthBounds(key);

  if (!force) {
    const cached = await findCachedReview(userId, "coach_monthly_review", key);
    if (cached && "monthKey" in cached) {
      return attachMonthlyReportDetails(userId, cached as MonthlyReviewResponse, key);
    }
  }

  const context = await buildReviewContext(userId, {
    weekKey: key,
    label: "monthly",
    rangeStart: start,
    rangeEnd: end,
  });

  const history30 = await getUnifiedHistory(userId, "30d");
  const narrative = await generateMonthlyReviewNarrative(context);

  const [insight] = await db
    .select({ totalVolume: activityInsights.totalVolumeLifted })
    .from(activityInsights)
    .where(eq(activityInsights.userId, userId))
    .limit(1);

  const response: MonthlyReviewResponse = {
    monthKey: key,
    monthLabel,
    overallScore: context.summary.overallScore,
    aiSummary: narrative.aiSummary,
    summary: {
      totalWorkouts: context.summary.workouts.completed,
      totalSteps: history30.totals.steps,
      totalVolumeKg: insight?.totalVolume ? parseFloat(String(insight.totalVolume)) : null,
      weightChange: context.summary.weight.change,
      bestWeekScore: context.summary.overallScore,
      currentWeightKg: context.summary.weight.end,
    },
    progressAnalysis: narrative.progressAnalysis,
    coachInsights: narrative.coachInsights,
    goalEvaluation: context.goal,
    nextMonthGoals: context.nextWeekGoals,
    achievementsUnlocked: context.achievements.unlockedThisPeriod,
    forecasts: context.forecasts,
    transformationTimeline: context.forecasts.transformationTimeline,
    personalRecords: context.forecasts.strength.map((s) => ({
      exercise: s.exercise,
      current: s.current,
      predicted: s.predicted,
      weeks: s.weeks,
    })),
    generatedAt: new Date().toISOString(),
    cached: false,
    narrativeSource: narrative.source,
    nextMonthFocus: narrative.nextWeekFocus,
    saved: false,
    reportId: null,
    savedAt: null,
  };

  const meta = await persistReview(userId, "coach_monthly_review", key, context, response);
  return { ...response, saved: true, reportId: meta.reportId, savedAt: meta.savedAt };
}

export async function getMonthlyReport(userId: string, monthKey?: string): Promise<MonthlyReviewResponse> {
  const key = monthKey ?? getCurrentMonthKey();
  const cached = await findCachedReview(userId, "coach_monthly_review", key);
  if (cached && "monthKey" in cached) {
    return attachMonthlyReportDetails(userId, cached as MonthlyReviewResponse, key);
  }
  return generateMonthlyReport(userId, key, false);
}

export function getTodayDateKey(date = new Date()): string {
  return toLocalDateKey(date);
}

function getYesterdayBounds(): { start: Date; end: Date; dateKey: string; dateLabel: string } {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  y.setHours(0, 0, 0, 0);
  const end = new Date(y);
  end.setHours(23, 59, 59, 999);
  return {
    start: y,
    end,
    dateKey: toLocalDateKey(y),
    dateLabel: y.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
  };
}

async function buildDailyDigestContext(userId: string): Promise<DailyDigestContext> {
  const todayKey = getTodayDateKey();
  const todayLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const { start, end, dateKey, dateLabel } = getYesterdayBounds();

  const [history, streak, userRow, workoutDates, nutritionRow] = await Promise.all([
    getHistoryForDateRange(userId, start, end),
    getStreakDetails(userId),
    findUserById(userId),
    getWorkoutDatesInRange(userId, start, end),
    db
      .select({ dailyCalories: nutritionTargets.dailyCalories })
      .from(nutritionTargets)
      .where(eq(nutritionTargets.userId, userId))
      .orderBy(desc(nutritionTargets.updatedAt))
      .limit(1),
  ]);

  const bucket = history.buckets[0] ?? {
    date: dateKey,
    steps: 0,
    caloriesBurned: 0,
    caloriesConsumed: 0,
    waterGlasses: 0,
    sleepHours: 0,
    weightKg: null,
    proteinG: 0,
    waterMl: 0,
  };

  return {
    dateKey: todayKey,
    dateLabel: todayLabel,
    fitnessGoal: userRow?.profile?.fitnessGoal ?? null,
    calorieGoal: nutritionRow[0]?.dailyCalories ?? null,
    streakDays: streak.currentStreak ?? 0,
    yesterday: {
      dateLabel,
      steps: bucket.steps,
      caloriesConsumed: bucket.caloriesConsumed,
      caloriesBurned: bucket.caloriesBurned,
      workoutCompleted: workoutDates.has(dateKey),
      sleepHours: bucket.sleepHours,
      waterGlasses: bucket.waterGlasses,
    },
    weekScore: null,
  };
}

export async function generateDailyDigest(
  userId: string,
  dateKey?: string,
  force = false,
): Promise<DailyDigestResponse> {
  const key = dateKey ?? getTodayDateKey();

  if (!force) {
    const meta = await findCachedReviewMeta(userId, "coach_daily_digest", key);
    if (meta?.responsePayload && typeof meta.responsePayload === "object") {
      return {
        ...(meta.responsePayload as object),
        cached: true,
        saved: true,
        reportId: meta.reportId,
        savedAt: meta.savedAt,
      } as DailyDigestResponse;
    }
  }

  const context = await buildDailyDigestContext(userId);
  const narrative = await generateDailyDigestNarrative(context);

  const response: DailyDigestResponse = {
    dateKey: key,
    dateLabel: context.dateLabel,
    tip: narrative.tip,
    focusAction: narrative.focusAction,
    category: narrative.category,
    yesterday: context.yesterday,
    streakDays: context.streakDays,
    fitnessGoal: context.fitnessGoal,
    generatedAt: new Date().toISOString(),
    cached: false,
    narrativeSource: narrative.source,
    saved: false,
    reportId: null,
    savedAt: null,
  };

  const meta = await upsertPersistReview(userId, "coach_daily_digest", key, response, context);
  return { ...response, saved: true, reportId: meta.reportId, savedAt: meta.savedAt };
}

export async function getDailyDigest(
  userId: string,
  dateKey?: string,
  force = false,
): Promise<DailyDigestResponse> {
  const key = dateKey ?? getTodayDateKey();
  if (force) {
    return generateDailyDigest(userId, key, true);
  }
  const meta = await findCachedReviewMeta(userId, "coach_daily_digest", key);
  if (meta?.responsePayload && typeof meta.responsePayload === "object") {
    return {
      ...(meta.responsePayload as object),
      cached: true,
      saved: true,
      reportId: meta.reportId,
      savedAt: meta.savedAt,
    } as DailyDigestResponse;
  }
  return generateDailyDigest(userId, key, false);
}

export async function canForceRegenerate(userId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [recent] = await db
    .select({ id: aiPlanRequests.id })
    .from(aiPlanRequests)
    .where(
      and(
        eq(aiPlanRequests.userId, userId),
        eq(aiPlanRequests.requestType, "coach_weekly_review"),
        gte(aiPlanRequests.createdAt, oneHourAgo),
      ),
    )
    .limit(1);
  return !recent;
}

export async function listSavedCoachReports(userId: string, limit = 12): Promise<SavedCoachReportSummary[]> {
  const rows = await db
    .select({
      reportId: aiPlanRequests.id,
      requestType: aiPlanRequests.requestType,
      periodKey: sql<string>`${aiPlanRequests.inputPayload}->>'periodKey'`,
      savedAt: aiPlanRequests.completedAt,
      responsePayload: aiPlanResponses.responsePayload,
    })
    .from(aiPlanRequests)
    .innerJoin(aiPlanResponses, eq(aiPlanResponses.requestId, aiPlanRequests.id))
    .where(
      and(
        eq(aiPlanRequests.userId, userId),
        eq(aiPlanRequests.status, "completed"),
        sql`${aiPlanRequests.requestType} IN ('coach_weekly_review', 'coach_monthly_review')`,
      ),
    )
    .orderBy(desc(aiPlanRequests.completedAt))
    .limit(limit);

  return rows
    .filter((r) => r.periodKey && r.responsePayload && typeof r.responsePayload === "object")
    .map((r) => {
      const payload = r.responsePayload as Record<string, unknown>;
      const type = r.requestType as "coach_weekly_review" | "coach_monthly_review";
      const periodLabel =
        type === "coach_weekly_review"
          ? String(payload.weekLabel ?? r.periodKey)
          : String(payload.monthLabel ?? r.periodKey);
      return {
        reportId: r.reportId,
        type,
        periodKey: r.periodKey,
        periodLabel,
        overallScore: Number(payload.overallScore ?? 0),
        savedAt: r.savedAt ? new Date(r.savedAt).toISOString() : new Date().toISOString(),
      };
    });
}

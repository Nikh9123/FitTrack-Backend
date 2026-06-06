import { and, eq, gte, lte, ne, or, isNull, sql } from "drizzle-orm";
import { db, activitySummaries, dailyCheckins, dietLogs, waterLogs, weightLogs } from "../db";

export type HistoryPeriod = "7d" | "30d" | "90d" | "1y";

export interface HistoryDayBucket {
  date: string;
  steps: number;
  caloriesBurned: number;
  sleepHours: number;
  caloriesConsumed: number;
  proteinG: number;
  waterMl: number;
  waterGlasses: number;
  weightKg: number | null;
}

export interface HistoryInsight {
  id: string;
  message: string;
  trend: "up" | "down" | "neutral";
  metric: string;
}

const ML_PER_GLASS = 250;

function periodToDays(period: HistoryPeriod): number {
  switch (period) {
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "1y":
      return 365;
    default:
      return 7;
  }
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayBounds(days: number) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(toLocalDateKey(d));
  }
  return { start, end, keys };
}

function emptyBucket(date: string): HistoryDayBucket {
  return {
    date,
    steps: 0,
    caloriesBurned: 0,
    sleepHours: 0,
    caloriesConsumed: 0,
    proteinG: 0,
    waterMl: 0,
    waterGlasses: 0,
    weightKg: null,
  };
}

export async function getUnifiedHistory(userId: string, period: HistoryPeriod = "7d") {
  const days = periodToDays(period);
  const { start, end, keys } = dayBounds(days);
  const bucketMap = new Map(keys.map((k) => [k, emptyBucket(k)]));

  const [activityRows, dietRows, waterRows, weightRows, checkinRows] = await Promise.all([
    db
      .select({
        summaryDate: activitySummaries.summaryDate,
        steps: activitySummaries.steps,
        caloriesBurned: activitySummaries.caloriesBurned,
        sleepMinutes: activitySummaries.sleepMinutes,
      })
      .from(activitySummaries)
      .where(and(eq(activitySummaries.userId, userId), gte(activitySummaries.summaryDate, start), lte(activitySummaries.summaryDate, end))),
    db
      .select({
        logDate: dietLogs.logDate,
        caloriesKcal: dietLogs.caloriesKcal,
        proteinG: dietLogs.proteinG,
      })
      .from(dietLogs)
      .where(and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, start), lte(dietLogs.logDate, end))),
    db
      .select({
        logDate: waterLogs.logDate,
        amountMl: waterLogs.amountMl,
      })
      .from(waterLogs)
      .where(and(eq(waterLogs.userId, userId), gte(waterLogs.logDate, start), lte(waterLogs.logDate, end))),
    db
      .select({
        recordedAt: weightLogs.recordedAt,
        weightKg: weightLogs.weightKg,
      })
      .from(weightLogs)
      .where(
        and(
          eq(weightLogs.userId, userId),
          gte(weightLogs.recordedAt, start),
          lte(weightLogs.recordedAt, end),
          or(isNull(weightLogs.notes), ne(weightLogs.notes, "fittrack_demo_seed")),
        ),
      ),
    db
      .select({
        checkinDate: dailyCheckins.checkinDate,
        sleepHours: dailyCheckins.sleepHours,
      })
      .from(dailyCheckins)
      .where(and(eq(dailyCheckins.userId, userId), gte(dailyCheckins.checkinDate, start), lte(dailyCheckins.checkinDate, end))),
  ]);

  for (const row of activityRows) {
    const key = toLocalDateKey(new Date(row.summaryDate));
    const b = bucketMap.get(key);
    if (!b) continue;
    b.steps += row.steps ?? 0;
    b.caloriesBurned += row.caloriesBurned ?? 0;
    if ((row.sleepMinutes ?? 0) > 0) {
      b.sleepHours = Math.round((row.sleepMinutes / 60) * 10) / 10;
    }
  }

  for (const row of dietRows) {
    const key = toLocalDateKey(new Date(row.logDate));
    const b = bucketMap.get(key);
    if (!b) continue;
    b.caloriesConsumed += parseFloat(String(row.caloriesKcal ?? 0));
    b.proteinG += parseFloat(String(row.proteinG ?? 0));
  }

  for (const row of waterRows) {
    const key = toLocalDateKey(new Date(row.logDate));
    const b = bucketMap.get(key);
    if (!b) continue;
    b.waterMl += row.amountMl ?? 0;
    b.waterGlasses = Math.round(b.waterMl / ML_PER_GLASS);
  }

  for (const row of checkinRows) {
    const key = toLocalDateKey(new Date(row.checkinDate));
    const b = bucketMap.get(key);
    if (!b) continue;
    const sleep = parseFloat(String(row.sleepHours ?? 0));
    if (sleep > 0 && b.sleepHours === 0) b.sleepHours = sleep;
  }

  for (const row of weightRows) {
    const key = toLocalDateKey(new Date(row.recordedAt));
    const b = bucketMap.get(key);
    if (!b) continue;
    b.weightKg = parseFloat(String(row.weightKg));
  }

  const buckets = keys.map((k) => bucketMap.get(k)!);

  const totals = buckets.reduce(
    (acc, b) => ({
      steps: acc.steps + b.steps,
      caloriesBurned: acc.caloriesBurned + b.caloriesBurned,
      caloriesConsumed: acc.caloriesConsumed + b.caloriesConsumed,
      waterGlasses: acc.waterGlasses + b.waterGlasses,
      daysWithSteps: acc.daysWithSteps + (b.steps > 0 ? 1 : 0),
      daysWithMeals: acc.daysWithMeals + (b.caloriesConsumed > 0 ? 1 : 0),
    }),
    { steps: 0, caloriesBurned: 0, caloriesConsumed: 0, waterGlasses: 0, daysWithSteps: 0, daysWithMeals: 0 },
  );

  const sleepDays = buckets.filter((b) => b.sleepHours > 0);

  return {
    period,
    days,
    buckets,
    totals,
    averages: {
      steps: Math.round(totals.steps / days),
      caloriesBurned: Math.round(totals.caloriesBurned / days),
      caloriesConsumed: totals.daysWithMeals > 0 ? Math.round(totals.caloriesConsumed / totals.daysWithMeals) : 0,
      waterGlasses: Math.round(totals.waterGlasses / days),
      sleepHours:
        sleepDays.length > 0
          ? Math.round((sleepDays.reduce((s, b) => s + b.sleepHours, 0) / sleepDays.length) * 10) / 10
          : 0,
    },
  };
}

export async function getHistoryInsights(userId: string, period: HistoryPeriod = "7d"): Promise<HistoryInsight[]> {
  const days = periodToDays(period);
  const current = await getUnifiedHistory(userId, period);

  const prevStart = new Date();
  prevStart.setDate(prevStart.getDate() - days * 2 + 1);
  prevStart.setHours(0, 0, 0, 0);
  const prevEnd = new Date();
  prevEnd.setDate(prevEnd.getDate() - days);
  prevEnd.setHours(23, 59, 59, 999);

  const [prevActivity] = await db
    .select({
      steps: sql<number>`coalesce(sum(${activitySummaries.steps}), 0)`.mapWith(Number),
    })
    .from(activitySummaries)
    .where(
      and(eq(activitySummaries.userId, userId), gte(activitySummaries.summaryDate, prevStart), lte(activitySummaries.summaryDate, prevEnd)),
    );

  const [prevDiet] = await db
    .select({
      calories: sql<number>`coalesce(sum(${dietLogs.caloriesKcal}::numeric), 0)`.mapWith(Number),
    })
    .from(dietLogs)
    .where(and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, prevStart), lte(dietLogs.logDate, prevEnd)));

  const insights: HistoryInsight[] = [];
  const prevSteps = prevActivity?.steps ?? 0;
  const curSteps = current.totals.steps;

  if (prevSteps > 0 && curSteps > 0) {
    const pct = Math.round(((curSteps - prevSteps) / prevSteps) * 100);
    if (Math.abs(pct) >= 5) {
      insights.push({
        id: "steps",
        metric: "steps",
        trend: pct > 0 ? "up" : "down",
        message:
          pct > 0
            ? `You walked ${pct}% more than the previous ${days} days — great momentum!`
            : `Steps are ${Math.abs(pct)}% lower than the previous ${days} days.`,
      });
    }
  }

  const prevCal = prevDiet?.calories ?? 0;
  const curCal = current.totals.caloriesConsumed;
  if (prevCal > 0 && curCal > 0) {
    const pct = Math.round(((curCal - prevCal) / prevCal) * 100);
    if (Math.abs(pct) >= 8) {
      insights.push({
        id: "calories",
        metric: "nutrition",
        trend: pct > 0 ? "up" : "down",
        message:
          pct > 0
            ? `Calorie intake is up ${pct}% vs last period.`
            : `You're eating ${Math.abs(pct)}% fewer calories than last period.`,
      });
    }
  }

  const weightBuckets = current.buckets.filter((b) => b.weightKg != null);
  if (weightBuckets.length >= 2) {
    const first = weightBuckets[0].weightKg!;
    const last = weightBuckets[weightBuckets.length - 1].weightKg!;
    const diff = Math.round((last - first) * 10) / 10;
    if (Math.abs(diff) >= 0.3) {
      insights.push({
        id: "weight",
        metric: "weight",
        trend: diff < 0 ? "down" : "up",
        message: diff < 0 ? `Weight down ${Math.abs(diff)} kg this period.` : `Weight up ${diff} kg this period.`,
      });
    }
  }

  if (current.averages.sleepHours > 0 && current.averages.sleepHours < 6.5) {
    insights.push({
      id: "sleep",
      metric: "sleep",
      trend: "down",
      message: `Average sleep is ${current.averages.sleepHours}h — aim for 7–8h for recovery.`,
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "start",
      metric: "general",
      trend: "neutral",
      message: "Keep logging meals, water, steps, and check-ins to unlock week-over-week insights.",
    });
  }

  return insights;
}

import { and, asc, desc, eq, gte, lte, ne, or, isNull, sql } from "drizzle-orm";
import {
  db,
  activitySummaries,
  dailyCheckins,
  dietLogs,
  inbodyReports,
  userProfiles,
  userWorkoutSessions,
  waterLogs,
  weightLogs,
} from "../db";
import { calcBmrMifflin } from "../lib/body-estimation";

export type HistoryPeriod = "7d" | "30d" | "90d" | "1y";
export type WeightChangePeriod = "1d" | "1w" | "1m" | "all";
export type WeightChangeSource = "scale" | "inbody";

export interface WeightChangeResult {
  deltaKg: number;
  direction: "lost" | "gained" | "unchanged";
  startKg: number;
  endKg: number;
  hasData: boolean;
  isEstimated?: boolean;
  disclaimer?: string | null;
  anchorDate?: string | null;
}

const KCAL_PER_KG_FAT = 7700;
const ESTIMATED_WEIGHT_DISCLAIMER =
  "Estimated from your food and activity. Scale weight may take 2–3 weeks to catch up.";

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
        metric: "calories",
        trend: pct > 0 ? "up" : "down",
        message:
          pct > 0
            ? `Calorie intake is up ${pct}% vs last period.`
            : `You're eating ${Math.abs(pct)}% fewer calories than last period.`,
      });
    }
  }

  const [prevWater] = await db
    .select({
      ml: sql<number>`coalesce(sum(${waterLogs.amountMl}), 0)`.mapWith(Number),
    })
    .from(waterLogs)
    .where(and(eq(waterLogs.userId, userId), gte(waterLogs.logDate, prevStart), lte(waterLogs.logDate, prevEnd)));

  const prevWaterGlasses = Math.round((prevWater?.ml ?? 0) / ML_PER_GLASS);
  const curWater = current.totals.waterGlasses;
  if (prevWaterGlasses > 0 && curWater > 0) {
    const pct = Math.round(((curWater - prevWaterGlasses) / prevWaterGlasses) * 100);
    if (Math.abs(pct) >= 8) {
      insights.push({
        id: "water",
        metric: "water",
        trend: pct > 0 ? "up" : "down",
        message:
          pct > 0
            ? `Hydration is up ${pct}% vs the previous ${days} days — nice work!`
            : `Water intake is ${Math.abs(pct)}% lower than the previous ${days} days.`,
      });
    }
  }

  const [prevSleep] = await db
    .select({
      avgHours: sql<number>`coalesce(avg(${dailyCheckins.sleepHours}::numeric), 0)`.mapWith(Number),
    })
    .from(dailyCheckins)
    .where(
      and(
        eq(dailyCheckins.userId, userId),
        gte(dailyCheckins.checkinDate, prevStart),
        lte(dailyCheckins.checkinDate, prevEnd),
        sql`${dailyCheckins.sleepHours} IS NOT NULL`,
      ),
    );

  const prevSleepAvg = Math.round((prevSleep?.avgHours ?? 0) * 10) / 10;
  const curSleepAvg = current.averages.sleepHours;
  if (prevSleepAvg > 0 && curSleepAvg > 0) {
    const diff = Math.round((curSleepAvg - prevSleepAvg) * 10) / 10;
    if (Math.abs(diff) >= 0.3) {
      insights.push({
        id: "sleep-trend",
        metric: "sleep",
        trend: diff > 0 ? "up" : "down",
        message:
          diff > 0
            ? `Sleep averaged ${curSleepAvg}h — up ${diff}h vs the previous ${days} days.`
            : `Sleep averaged ${curSleepAvg}h — ${Math.abs(diff)}h less than the previous ${days} days.`,
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
      id: "sleep-low",
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

function parseWeightKg(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  const n = parseFloat(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function weightChangeBounds(period: WeightChangePeriod): { start: Date | null; end: Date } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  if (period === "all") {
    return { start: null, end };
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);

  if (period === "1d") {
    start.setDate(start.getDate() - 1);
    return { start, end };
  }
  if (period === "1w") {
    start.setDate(start.getDate() - 6);
    return { start, end };
  }
  // 1m
  start.setDate(start.getDate() - 29);
  return { start, end };
}

function buildWeightChangeResult(
  startKg: number,
  endKg: number,
  opts?: Pick<WeightChangeResult, "isEstimated" | "disclaimer" | "anchorDate">,
): WeightChangeResult {
  const deltaKg = Math.round((endKg - startKg) * 10) / 10;
  let direction: WeightChangeResult["direction"] = "unchanged";
  if (Math.abs(deltaKg) >= 0.1) {
    direction = deltaKg < 0 ? "lost" : "gained";
  }
  return {
    deltaKg,
    direction,
    startKg: Math.round(startKg * 10) / 10,
    endKg: Math.round(endKg * 10) / 10,
    hasData: true,
    isEstimated: opts?.isEstimated ?? false,
    disclaimer: opts?.disclaimer ?? null,
    anchorDate: opts?.anchorDate ?? null,
  };
}

function ageFromDateOfBirth(dob: string | null | undefined): number {
  if (!dob) return 30;
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return 30;
  const today = new Date();
  let age = today.getFullYear() - born.getFullYear();
  const monthDelta = today.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < born.getDate())) {
    age -= 1;
  }
  return Math.max(16, Math.min(90, age));
}

function normalizeGender(raw: string | null | undefined): "male" | "female" {
  const g = String(raw ?? "").toLowerCase();
  if (g.startsWith("f")) return "female";
  return "male";
}

function dayKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start);
  cursor.setHours(12, 0, 0, 0);
  const endMs = new Date(end).setHours(23, 59, 59, 999);
  while (cursor.getTime() <= endMs) {
    keys.push(toLocalDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function nextDayKey(dateKey: string): string {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return toLocalDateKey(d);
}

function dateKeyToDate(dateKey: string): Date {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function resolveUserBmr(userId: string, fallbackWeightKg: number): Promise<number> {
  const [profile] = await db
    .select({
      heightCm: userProfiles.heightCm,
      weightKg: userProfiles.weightKg,
      gender: userProfiles.gender,
      dateOfBirth: userProfiles.dateOfBirth,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const weightKg = parseWeightKg(profile?.weightKg) ?? fallbackWeightKg;
  const heightCm = parseWeightKg(profile?.heightCm) ?? 170;
  const age = ageFromDateOfBirth(profile?.dateOfBirth ?? null);
  const gender = normalizeGender(profile?.gender);

  if (!Number.isFinite(weightKg) || weightKg <= 0) return 2000;
  return Math.round(calcBmrMifflin(weightKg, heightCm, age, gender));
}

async function getLatestWeightAnchor(
  userId: string,
  before: Date,
): Promise<{ anchorKg: number; anchorDate: string } | null> {
  const [row] = await db
    .select({ recordedAt: weightLogs.recordedAt, weightKg: weightLogs.weightKg })
    .from(weightLogs)
    .where(
      and(
        eq(weightLogs.userId, userId),
        lte(weightLogs.recordedAt, before),
        or(isNull(weightLogs.notes), ne(weightLogs.notes, "fittrack_demo_seed")),
      ),
    )
    .orderBy(desc(weightLogs.recordedAt))
    .limit(1);

  const anchorKg = parseWeightKg(row?.weightKg);
  if (row == null || anchorKg == null) return null;
  return { anchorKg, anchorDate: toLocalDateKey(new Date(row.recordedAt)) };
}

async function getEstimatedScaleWeightChange(
  userId: string,
  period: WeightChangePeriod,
): Promise<WeightChangeResult> {
  const { start, end } = weightChangeBounds(period);
  const anchor = await getLatestWeightAnchor(userId, end);
  if (!anchor) {
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  const firstDeficitDay = nextDayKey(anchor.anchorDate);
  const dataStart = dateKeyToDate(firstDeficitDay);
  const periodStart = start ?? dateKeyToDate(anchor.anchorDate);
  if (dataStart.getTime() > end.getTime()) {
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  const periodDayKeys = dayKeysBetween(periodStart > dataStart ? periodStart : dataStart, end);
  const allDayKeys = dayKeysBetween(dataStart, end);
  if (periodDayKeys.length === 0) {
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  const rangeEndKey = toLocalDateKey(end);

  const [activityRows, dietRows, workoutRows, dailyBmr] = await Promise.all([
    db
      .select({
        summaryDate: activitySummaries.summaryDate,
        caloriesBurned: activitySummaries.caloriesBurned,
        steps: activitySummaries.steps,
      })
      .from(activitySummaries)
      .where(
        and(
          eq(activitySummaries.userId, userId),
          gte(activitySummaries.summaryDate, dataStart),
          lte(activitySummaries.summaryDate, end),
        ),
      ),
    db
      .select({
        logDate: dietLogs.logDate,
        caloriesKcal: dietLogs.caloriesKcal,
      })
      .from(dietLogs)
      .where(
        and(eq(dietLogs.userId, userId), gte(dietLogs.logDate, dataStart), lte(dietLogs.logDate, end)),
      ),
    db
      .select({
        startedAt: userWorkoutSessions.startedAt,
        completedAt: userWorkoutSessions.completedAt,
        caloriesBurned: userWorkoutSessions.caloriesBurned,
      })
      .from(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.userId, userId),
          or(
            and(gte(userWorkoutSessions.completedAt, dataStart), lte(userWorkoutSessions.completedAt, end)),
            and(
              isNull(userWorkoutSessions.completedAt),
              gte(userWorkoutSessions.startedAt, dataStart),
              lte(userWorkoutSessions.startedAt, end),
            ),
          ),
        ),
      ),
    resolveUserBmr(userId, anchor.anchorKg),
  ]);

  const consumedByDay = new Map<string, number>();
  const burnedByDay = new Map<string, number>();

  for (const key of allDayKeys) {
    consumedByDay.set(key, 0);
    burnedByDay.set(key, dailyBmr);
  }

  for (const row of dietRows) {
    const key = toLocalDateKey(new Date(row.logDate));
    if (!consumedByDay.has(key)) continue;
    consumedByDay.set(key, (consumedByDay.get(key) ?? 0) + parseFloat(String(row.caloriesKcal ?? 0)));
  }

  for (const row of activityRows) {
    const key = toLocalDateKey(new Date(row.summaryDate));
    if (!burnedByDay.has(key)) continue;
    burnedByDay.set(key, (burnedByDay.get(key) ?? dailyBmr) + (row.caloriesBurned ?? 0));
  }

  for (const row of workoutRows) {
    const when = row.completedAt ?? row.startedAt;
    const key = toLocalDateKey(new Date(when));
    if (!burnedByDay.has(key)) continue;
    burnedByDay.set(key, (burnedByDay.get(key) ?? dailyBmr) + (row.caloriesBurned ?? 0));
  }

  let trackedDays = 0;
  for (const key of periodDayKeys) {
    const consumed = consumedByDay.get(key) ?? 0;
    const activityExtra = (burnedByDay.get(key) ?? dailyBmr) - dailyBmr;
    if (consumed > 0 || activityExtra > 0) trackedDays += 1;
  }

  if (trackedDays === 0) {
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  const deficitFromAnchorTo = (throughKey: string): number => {
    let total = 0;
    let cursor = firstDeficitDay;
    const throughMs = dateKeyToDate(throughKey).getTime();
    while (dateKeyToDate(cursor).getTime() <= throughMs) {
      const burned = burnedByDay.get(cursor) ?? dailyBmr;
      const consumed = consumedByDay.get(cursor) ?? 0;
      total += burned - consumed;
      cursor = nextDayKey(cursor);
    }
    return total;
  };

  const periodStartKey = toLocalDateKey(periodStart);
  const weightAt = (throughKey: string): number => {
    const deficitKcal = deficitFromAnchorTo(throughKey);
    return anchor.anchorKg - deficitKcal / KCAL_PER_KG_FAT;
  };

  const startKg = weightAt(periodStartKey);
  const endKg = weightAt(rangeEndKey);

  return buildWeightChangeResult(startKg, endKg, {
    isEstimated: true,
    disclaimer: ESTIMATED_WEIGHT_DISCLAIMER,
    anchorDate: anchor.anchorDate,
  });
}

function latestWeightByDate(
  rows: Array<{ recordedAt: Date; weightKg: string | null }>,
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const key = toLocalDateKey(new Date(row.recordedAt));
    const w = parseWeightKg(row.weightKg);
    if (w != null) byDate.set(key, w);
  }
  return byDate;
}

async function getLoggedScaleWeightChange(
  userId: string,
  period: WeightChangePeriod,
): Promise<WeightChangeResult | null> {
  const { start, end } = weightChangeBounds(period);

  const conditions = [
    eq(weightLogs.userId, userId),
    lte(weightLogs.recordedAt, end),
    or(isNull(weightLogs.notes), ne(weightLogs.notes, "fittrack_demo_seed")),
  ];
  if (start) {
    conditions.push(gte(weightLogs.recordedAt, start));
  }

  const rows = await db
    .select({ recordedAt: weightLogs.recordedAt, weightKg: weightLogs.weightKg })
    .from(weightLogs)
    .where(and(...conditions))
    .orderBy(asc(weightLogs.recordedAt));

  if (period === "1d") {
    const todayKey = toLocalDateKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toLocalDateKey(yesterday);

    const allRows = await db
      .select({ recordedAt: weightLogs.recordedAt, weightKg: weightLogs.weightKg })
      .from(weightLogs)
      .where(
        and(
          eq(weightLogs.userId, userId),
          or(isNull(weightLogs.notes), ne(weightLogs.notes, "fittrack_demo_seed")),
        ),
      )
      .orderBy(asc(weightLogs.recordedAt));

    const byDate = latestWeightByDate(allRows);
    const todayKg = byDate.get(todayKey);
    const yesterdayKg = byDate.get(yesterdayKey);
    if (todayKg != null && yesterdayKg != null) {
      return buildWeightChangeResult(yesterdayKg, todayKg);
    }
    return null;
  }

  if (rows.length < 2) {
    return null;
  }

  const first = parseWeightKg(rows[0].weightKg)!;
  const last = parseWeightKg(rows[rows.length - 1].weightKg)!;
  return buildWeightChangeResult(first, last);
}

async function getScaleWeightChange(
  userId: string,
  period: WeightChangePeriod,
): Promise<WeightChangeResult> {
  const logged = await getLoggedScaleWeightChange(userId, period);
  if (logged) return logged;
  return getEstimatedScaleWeightChange(userId, period);
}

async function getInbodyWeightChange(
  userId: string,
  period: WeightChangePeriod,
): Promise<WeightChangeResult> {
  const { start, end } = weightChangeBounds(period);

  const conditions = [
    eq(inbodyReports.userId, userId),
    eq(inbodyReports.status, "done"),
    lte(inbodyReports.createdAt, end),
  ];
  if (start) {
    conditions.push(gte(inbodyReports.createdAt, start));
  }

  const rows = await db
    .select({ createdAt: inbodyReports.createdAt, extractedMetrics: inbodyReports.extractedMetrics })
    .from(inbodyReports)
    .where(and(...conditions))
    .orderBy(asc(inbodyReports.createdAt));

  if (period === "1d") {
    const todayKey = toLocalDateKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = toLocalDateKey(yesterday);

    const allRows = await db
      .select({ createdAt: inbodyReports.createdAt, extractedMetrics: inbodyReports.extractedMetrics })
      .from(inbodyReports)
      .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
      .orderBy(asc(inbodyReports.createdAt));

    const byDate = new Map<string, number>();
    for (const row of allRows) {
      const m = (row.extractedMetrics ?? {}) as Record<string, string>;
      const w = parseWeightKg(m.weight);
      if (w != null) byDate.set(toLocalDateKey(new Date(row.createdAt)), w);
    }
    const todayKg = byDate.get(todayKey);
    const yesterdayKg = byDate.get(yesterdayKey);
    if (todayKg != null && yesterdayKg != null) {
      return buildWeightChangeResult(yesterdayKg, todayKg);
    }
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  const weights: number[] = [];
  for (const row of rows) {
    const m = (row.extractedMetrics ?? {}) as Record<string, string>;
    const w = parseWeightKg(m.weight);
    if (w != null) weights.push(w);
  }

  if (weights.length < 2) {
    return { deltaKg: 0, direction: "unchanged", startKg: 0, endKg: 0, hasData: false };
  }

  return buildWeightChangeResult(weights[0], weights[weights.length - 1]);
}

export async function getWeightChange(
  userId: string,
  period: WeightChangePeriod = "1w",
  source: WeightChangeSource = "scale",
): Promise<WeightChangeResult> {
  if (source === "inbody") {
    return getInbodyWeightChange(userId, period);
  }
  return getScaleWeightChange(userId, period);
}

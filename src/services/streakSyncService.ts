import { and, eq, sql } from "drizzle-orm";
import {
  activityInsights,
  db,
  userStreaks,
  userWorkoutSessions,
} from "../db";
import { logger } from "../lib/logger";

export type StreakKind = "workout" | "checkin" | "diet" | "hydration";

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function subtractDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - days);
  return copy;
}

/** Longest run of consecutive calendar days in a sorted date list. */
export function computeLongestConsecutiveDays(sortedUniqueDates: string[]): number {
  if (sortedUniqueDates.length === 0) return 0;
  const sorted = [...new Set(sortedUniqueDates)].sort();
  let max = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]}T12:00:00`);
    const curr = new Date(`${sorted[i]}T12:00:00`);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86_400_000);
    if (diffDays === 1) {
      current++;
      max = Math.max(max, current);
    } else if (diffDays > 1) {
      current = 1;
    }
  }

  return max;
}

/** Current workout streak from completed session dates (matches workoutService logic). */
export function computeCurrentWorkoutStreak(activeDatesDesc: string[]): number {
  if (activeDatesDesc.length === 0) return 0;

  const now = new Date();
  const todayStr = toLocalDateString(now);
  const yesterdayStr = toLocalDateString(subtractDays(now, 1));
  const latestActiveDate = activeDatesDesc[0];

  if (latestActiveDate !== todayStr && latestActiveDate !== yesterdayStr) {
    return 0;
  }

  let currentStreak = 1;
  let expectedDate = subtractDays(new Date(`${latestActiveDate}T12:00:00`), 1);

  for (let i = 1; i < activeDatesDesc.length; i++) {
    const expectedStr = toLocalDateString(expectedDate);
    if (activeDatesDesc[i] === expectedStr) {
      currentStreak++;
      expectedDate = subtractDays(expectedDate, 1);
    } else {
      break;
    }
  }

  return currentStreak;
}

async function fetchWorkoutActiveDates(userId: string): Promise<string[]> {
  const completed = await db
    .select({ completedAt: userWorkoutSessions.completedAt })
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(sql`${userWorkoutSessions.completedAt} DESC`);

  return Array.from(
    new Set(
      completed
        .filter((s) => s.completedAt)
        .map((s) => toLocalDateString(new Date(s.completedAt!))),
    ),
  ).sort((a, b) => b.localeCompare(a));
}

/** Upsert a row in user_streaks for the given streak type. */
export async function upsertUserStreak(
  userId: string,
  type: StreakKind,
  currentStreak: number,
  longestStreak: number,
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(userStreaks)
    .where(and(eq(userStreaks.userId, userId), eq(userStreaks.type, type)))
    .limit(1);

  const longest = Math.max(longestStreak, existing?.longestStreak ?? 0, currentStreak);

  if (existing) {
    await db
      .update(userStreaks)
      .set({
        currentStreak,
        longestStreak: longest,
        lastActiveAt: currentStreak > 0 ? now : existing.lastActiveAt,
        calculatedAt: now,
      })
      .where(eq(userStreaks.id, existing.id));
  } else {
    await db.insert(userStreaks).values({
      userId,
      type,
      currentStreak,
      longestStreak: longest,
      lastActiveAt: currentStreak > 0 ? now : null,
      calculatedAt: now,
    });
  }
}

/**
 * Sync workout streak from activity_insights (or recompute) into user_streaks.
 * Call after recalculateActivityInsights.
 */
export async function syncWorkoutStreakToUserStreaks(
  userId: string,
  currentStreakFromInsights?: number,
): Promise<{ currentStreak: number; longestStreak: number }> {
  try {
    const activeDatesDesc = await fetchWorkoutActiveDates(userId);
    const activeDatesAsc = [...activeDatesDesc].reverse();

    let currentStreak = currentStreakFromInsights;
    if (currentStreak === undefined) {
      const [insight] = await db
        .select({ streakDays: activityInsights.streakDays })
        .from(activityInsights)
        .where(eq(activityInsights.userId, userId))
        .limit(1);
      currentStreak = insight?.streakDays ?? computeCurrentWorkoutStreak(activeDatesDesc);
    }

    const longestStreak = computeLongestConsecutiveDays(activeDatesAsc);
    await upsertUserStreak(userId, "workout", currentStreak, longestStreak);

    logger.info({ userId, currentStreak, longestStreak }, "Synced workout streak to user_streaks");
    return { currentStreak, longestStreak };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err: message, userId }, "Failed to sync workout streak");
    return { currentStreak: 0, longestStreak: 0 };
  }
}

/** Read unified workout streak stats — activity_insights is source of truth for current. */
export async function getWorkoutStreakStats(userId: string): Promise<{
  currentStreak: number;
  longestStreak: number;
}> {
  const [insight, streakRow] = await Promise.all([
    db
      .select({ streakDays: activityInsights.streakDays })
      .from(activityInsights)
      .where(eq(activityInsights.userId, userId))
      .limit(1),
    db
      .select({
        currentStreak: userStreaks.currentStreak,
        longestStreak: userStreaks.longestStreak,
      })
      .from(userStreaks)
      .where(and(eq(userStreaks.userId, userId), eq(userStreaks.type, "workout")))
      .limit(1),
  ]);

  const currentStreak = insight[0]?.streakDays ?? streakRow[0]?.currentStreak ?? 0;
  const longestStreak = streakRow[0]?.longestStreak ?? currentStreak;

  return { currentStreak, longestStreak };
}

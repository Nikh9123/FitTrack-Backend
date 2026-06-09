import { db, activitySummaries, connectedFitnessDevices } from "../db";
import { and, eq, gte, lte } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface DailyActivityInput {
  summaryDate: string;
  steps: number;
  walkingMinutes: number;
  runningMinutes: number;
  caloriesBurned: number;
  distanceMeters: number;
  rawPayload?: Record<string, unknown> | null;
}

function dayBounds(dateInput: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (!match) {
    throw new Error("Invalid summaryDate");
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { dayStart, dayEnd };
}

async function findOrCreatePhoneDevice(userId: string) {
  const [existing] = await db
    .select()
    .from(connectedFitnessDevices)
    .where(
      and(
        eq(connectedFitnessDevices.userId, userId),
        eq(connectedFitnessDevices.provider, "phone_sensors"),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(connectedFitnessDevices)
      .set({ lastSyncAt: new Date(), status: "connected" })
      .where(eq(connectedFitnessDevices.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [created] = await db
    .insert(connectedFitnessDevices)
    .values({
      userId,
      provider: "phone_sensors",
      deviceName: "Phone sensors",
      status: "connected",
      lastSyncAt: new Date(),
    })
    .returning();

  return created;
}

export async function upsertDailyActivitySummary(userId: string, input: DailyActivityInput) {
  const { dayStart, dayEnd } = dayBounds(input.summaryDate);
  const device = await findOrCreatePhoneDevice(userId);

  const [existing] = await db
    .select()
    .from(activitySummaries)
    .where(
      and(
        eq(activitySummaries.userId, userId),
        eq(activitySummaries.sourceType, "phone_sensors"),
        gte(activitySummaries.summaryDate, dayStart),
        lte(activitySummaries.summaryDate, dayEnd),
      ),
    )
    .limit(1);

  const values = {
    userId,
    sourceDeviceId: device.id,
    sourceType: "phone_sensors" as const,
    summaryDate: dayStart,
    steps: Math.max(0, Math.floor(input.steps)),
    walkingMinutes: Math.max(0, Math.floor(input.walkingMinutes)),
    runningMinutes: Math.max(0, Math.floor(input.runningMinutes)),
    caloriesBurned: Math.max(0, Math.floor(input.caloriesBurned)),
    distanceMeters: Math.max(0, Math.floor(input.distanceMeters)),
    rawPayload: input.rawPayload ?? null,
    syncedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db
      .update(activitySummaries)
      .set(values)
      .where(eq(activitySummaries.id, existing.id))
      .returning();

    logger.info({ userId, summaryDate: input.summaryDate, steps: values.steps }, "Activity summary updated");
    return updated;
  }

  const [created] = await db.insert(activitySummaries).values(values).returning();
  logger.info({ userId, summaryDate: input.summaryDate, steps: values.steps }, "Activity summary created");
  return created;
}

export async function getRecentActivitySummaries(userId: string, days = 7) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  return db
    .select()
    .from(activitySummaries)
    .where(and(eq(activitySummaries.userId, userId), gte(activitySummaries.summaryDate, since)))
    .orderBy(activitySummaries.summaryDate);
}

export async function upsertSleepMinutes(userId: string, summaryDate: string, sleepHours: number) {
  const minutes = Math.max(0, Math.round(sleepHours * 60));
  const { dayStart, dayEnd } = dayBounds(summaryDate);

  const [existing] = await db
    .select()
    .from(activitySummaries)
    .where(
      and(
        eq(activitySummaries.userId, userId),
        gte(activitySummaries.summaryDate, dayStart),
        lte(activitySummaries.summaryDate, dayEnd),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(activitySummaries)
      .set({ sleepMinutes: minutes, syncedAt: new Date() })
      .where(eq(activitySummaries.id, existing.id))
      .returning();
    return updated;
  }

  const device = await findOrCreatePhoneDevice(userId);
  const [created] = await db
    .insert(activitySummaries)
    .values({
      userId,
      sourceDeviceId: device.id,
      sourceType: "phone_sensors",
      summaryDate: dayStart,
      sleepMinutes: minutes,
      syncedAt: new Date(),
    })
    .returning();

  return created;
}

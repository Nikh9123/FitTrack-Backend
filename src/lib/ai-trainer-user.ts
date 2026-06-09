import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, userProfiles, users } from "../db";
import { logger } from "./logger";

const AI_COACH_EMAIL = "ai-coach@veera.internal";

let cachedAiCoachUserId: string | null = null;

export async function getAiCoachUserId(): Promise<string> {
  if (process.env.AI_TRAINER_SYSTEM_USER_ID) {
    return process.env.AI_TRAINER_SYSTEM_USER_ID;
  }

  if (cachedAiCoachUserId) return cachedAiCoachUserId;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, AI_COACH_EMAIL)).limit(1);
  if (existing) {
    cachedAiCoachUserId = existing.id;
    return existing.id;
  }

  const passwordHash = await bcrypt.hash(`ai-coach-${Date.now()}`, 10);
  const [created] = await db
    .insert(users)
    .values({
      email: AI_COACH_EMAIL,
      passwordHash,
      status: "active",
      primaryRole: "member",
      isEmailVerified: true,
    })
    .returning({ id: users.id });

  await db.insert(userProfiles).values({
    userId: created.id,
    firstName: "Veera",
    lastName: "Coach",
    onboardingCompleted: true,
  });

  logger.info({ userId: created.id }, "Created AI coach system user");
  cachedAiCoachUserId = created.id;
  return created.id;
}

export function isAiCoachUser(senderId: string, aiCoachUserId: string): boolean {
  return senderId === aiCoachUserId;
}

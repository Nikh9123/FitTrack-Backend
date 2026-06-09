import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import {
  evaluateAchievements,
  getAchievementProgress,
  getJourneyProgress,
} from "../services/achievementService";
import { logger } from "../lib/logger";

export async function listAchievements(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const data = await getAchievementProgress(userId);
    return res.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch achievements";
    logger.error({ err: message, userId }, "listAchievements failed");
    return res.status(500).json({ error: message });
  }
}

export async function getJourney(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const journey = await getJourneyProgress(userId);
    return res.json({ journey });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch journey";
    logger.error({ err: message, userId }, "getJourney failed");
    return res.status(500).json({ error: message });
  }
}

export async function evaluateAchievementsEndpoint(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const trigger = (req.body?.trigger as string) ?? "manual";
  const allowed = new Set(["workout", "steps", "weight", "checkin", "water", "meal", "manual"]);
  if (!allowed.has(trigger)) {
    return res.status(400).json({ error: "Invalid trigger" });
  }

  try {
    const newlyUnlocked = await evaluateAchievements(userId, trigger as Parameters<typeof evaluateAchievements>[1]);
    return res.json({ newlyUnlocked });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to evaluate achievements";
    logger.error({ err: message, userId }, "evaluateAchievementsEndpoint failed");
    return res.status(500).json({ error: message });
  }
}

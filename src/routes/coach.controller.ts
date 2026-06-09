import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  canForceRegenerate,
  generateMonthlyReport,
  generateWeeklyReview,
  getDailyDigest,
  getMonthlyReport,
  getWeeklyReview,
  listSavedCoachReports,
} from "../services/coachReviewService";

export async function getWeeklyReviewHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const week = typeof req.query.week === "string" ? req.query.week : undefined;

  try {
    const review = await getWeeklyReview(userId, week);
    return res.json(review);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch weekly review";
    logger.error({ err: message, userId }, "getWeeklyReview failed");
    return res.status(500).json({ error: message });
  }
}

export async function generateWeeklyReviewHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const week = typeof req.body?.week === "string" ? req.body.week : undefined;

  try {
    const allowed = await canForceRegenerate(userId);
    if (!allowed) {
      return res.status(429).json({ error: "You can regenerate at most once per hour." });
    }

    const review = await generateWeeklyReview(userId, week, true);
    return res.json(review);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate weekly review";
    logger.error({ err: message, userId }, "generateWeeklyReview failed");
    return res.status(500).json({ error: message });
  }
}

export async function getMonthlyReportHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const month = typeof req.query.month === "string" ? req.query.month : undefined;

  try {
    const report = await getMonthlyReport(userId, month);
    return res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch monthly report";
    logger.error({ err: message, userId }, "getMonthlyReport failed");
    return res.status(500).json({ error: message });
  }
}

export async function generateMonthlyReportHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const month = typeof req.body?.month === "string" ? req.body.month : undefined;

  try {
    const allowed = await canForceRegenerate(userId);
    if (!allowed) {
      return res.status(429).json({ error: "You can regenerate at most once per hour." });
    }

    const report = await generateMonthlyReport(userId, month, true);
    return res.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate monthly report";
    logger.error({ err: message, userId }, "generateMonthlyReport failed");
    return res.status(500).json({ error: message });
  }
}

export async function listCoachReportsHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const limit = typeof req.query.limit === "string" ? Math.min(parseInt(req.query.limit, 10) || 12, 50) : 12;

  try {
    const reports = await listSavedCoachReports(userId, limit);
    return res.json({ reports });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list coach reports";
    logger.error({ err: message, userId }, "listCoachReports failed");
    return res.status(500).json({ error: message });
  }
}

export async function getDailyDigestHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  const refresh = req.query.refresh === "true" || req.query.refresh === "1";

  try {
    const digest = await getDailyDigest(userId, date, refresh);
    return res.json(digest);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch daily digest";
    logger.error({ err: message, userId }, "getDailyDigest failed");
    return res.status(500).json({ error: message });
  }
}

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  getProgressDashboard,
  saveCheckin,
  getTodayCheckin,
  logWeight,
  getAIInsights,
  getFitnessScore,
  getRecentCheckins,
} from "./progress.controller";

const router = Router();

router.get("/progress/dashboard", requireAuth, getProgressDashboard);
router.post("/progress/checkin", requireAuth, saveCheckin);
router.get("/progress/checkin/today", requireAuth, getTodayCheckin);
router.get("/progress/checkins/recent", requireAuth, getRecentCheckins);
router.post("/progress/weight", requireAuth, logWeight);
router.get("/progress/ai-insights", requireAuth, getAIInsights);
router.get("/progress/fitness-score", requireAuth, getFitnessScore);

export default router;

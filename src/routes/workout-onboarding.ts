/**
 * Workout Onboarding Routes
 * -------------------------
 * GET  /api/workout/onboarding/status
 * POST /api/workout/onboarding/ai-recommend
 * POST /api/workout/onboarding/generate-plan
 * POST /api/workout/onboarding/save
 * POST /api/workout/onboarding/reset
 */

import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  getOnboardingStatus,
  aiRecommendGoal,
  generateWorkoutPlan,
  saveOnboarding,
  resetOnboarding,
} from "./workout-onboarding.controller";

const router = Router();

router.get("/workout/onboarding/status", requireAuth, getOnboardingStatus);
router.post("/workout/onboarding/ai-recommend", requireAuth, aiRecommendGoal);
router.post("/workout/onboarding/generate-plan", requireAuth, generateWorkoutPlan);
router.post("/workout/onboarding/save", requireAuth, saveOnboarding);
router.post("/workout/onboarding/reset", requireAuth, resetOnboarding);

export default router;

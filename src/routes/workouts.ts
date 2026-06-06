import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  getCurrentPlan,
  startSession,
  logExerciseSet,
  completeSession,
  getHistory,
  getInsights,
  getPRs,
  getStreaks,
  persistWorkoutPlan,
  cancelSession,
  cancelCurrentActiveSession,
} from "../controllers/workoutController";

const router = Router();

router.get("/workouts/current", requireAuth, getCurrentPlan);
router.post("/workout/persist", requireAuth, persistWorkoutPlan);
router.post("/workouts/session/start", requireAuth, startSession);
router.post("/workouts/session/log", requireAuth, logExerciseSet);
router.post("/workouts/session/complete", requireAuth, completeSession);
router.delete("/workouts/session/:id", requireAuth, cancelSession);
router.delete("/workouts/session", requireAuth, cancelCurrentActiveSession);
router.post("/workouts/session/cancel", requireAuth, cancelCurrentActiveSession);
router.get("/workouts/history", requireAuth, getHistory);
router.get("/workouts/insights", requireAuth, getInsights);
router.get("/workouts/personal-records", requireAuth, getPRs);
router.get("/workouts/streaks", requireAuth, getStreaks);

export default router;

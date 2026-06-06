import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../lib/auth";
import {
  analyzeMealPhotoHandler,
  activatePlan,
  assignDietPlan,
  createDietLog,
  createWaterLog,
  generateAiPlan,
  getActivePlan,
  getDietHistory,
  getDietPlan,
  getDietSummary,
  getGoals,
  getHydrationSummary,
  listDietPlans,
  removeDietLog,
  searchFoodItems,
} from "./diet.controller";

const router = Router();

const mealPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

router.get("/food/search", requireAuth, searchFoodItems);
router.post("/food/analyze-photo", requireAuth, mealPhotoUpload.single("photo"), analyzeMealPhotoHandler);
router.get("/diet/plans", requireAuth, listDietPlans);
router.get("/diet/plans/active", requireAuth, getActivePlan);
router.get("/diet/plans/:id", requireAuth, getDietPlan);
router.post("/diet/plans/generate", requireAuth, generateAiPlan);
router.post("/diet/plans/assign", requireAuth, assignDietPlan);
router.patch("/diet/plans/:id/activate", requireAuth, activatePlan);
router.get("/diet/summary", requireAuth, getDietSummary);
router.get("/diet/history", requireAuth, getDietHistory);
router.post("/diet/logs", requireAuth, createDietLog);
router.delete("/diet/logs/:id", requireAuth, removeDietLog);
router.get("/hydration/summary", requireAuth, getHydrationSummary);
router.post("/hydration/log", requireAuth, createWaterLog);
router.get("/nutrition/goals", requireAuth, getGoals);

export default router;

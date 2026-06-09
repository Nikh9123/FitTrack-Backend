import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import {
  evaluateAchievementsEndpoint,
  getJourney,
  listAchievements,
} from "./achievements.controller";

const router: IRouter = Router();

router.get("/achievements", requireAuth, listAchievements);
router.get("/achievements/journey", requireAuth, getJourney);
router.post("/achievements/evaluate", requireAuth, evaluateAchievementsEndpoint);

export default router;

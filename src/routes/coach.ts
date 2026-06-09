import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import {
  generateMonthlyReportHandler,
  generateWeeklyReviewHandler,
  getMonthlyReportHandler,
  getWeeklyReviewHandler,
  getDailyDigestHandler,
  listCoachReportsHandler,
} from "./coach.controller";

const router: IRouter = Router();

router.get("/coach/weekly-review", requireAuth, getWeeklyReviewHandler);
router.post("/coach/weekly-review/generate", requireAuth, generateWeeklyReviewHandler);
router.get("/coach/monthly-report", requireAuth, getMonthlyReportHandler);
router.post("/coach/monthly-report/generate", requireAuth, generateMonthlyReportHandler);
router.get("/coach/daily-digest", requireAuth, getDailyDigestHandler);
router.get("/coach/reports", requireAuth, listCoachReportsHandler);

export default router;

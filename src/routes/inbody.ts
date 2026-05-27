/**
 * InBody Routes
 * -------------
 * Mounts:
 *   POST   /api/inbody/upload              — Upload + OCR + Gemini AI a report
 *   POST   /api/inbody/analyze/:reportId   — Run Gemini AI on existing report
 *   GET    /api/inbody/reports              — List user's reports
 *   GET    /api/inbody/reports/:id          — Get a single report
 */

import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../lib/auth";
import {
  uploadInbodyReport,
  analyzeInbodyReport,
  listInbodyReports,
  getInbodyReport,
} from "./inbody.controller";

const router = Router();

// ── Multer: store files in memory (buffer), max 10 MB ─────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter(_req, file, cb) {
    const allowed = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/heic",
      "application/pdf",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ── Routes ────────────────────────────────────────────────────────────────────
router.post(
  "/inbody/upload",
  requireAuth,
  upload.single("report"),
  uploadInbodyReport,
);

router.post("/inbody/analyze/:reportId", requireAuth, analyzeInbodyReport);

router.get("/inbody/reports", requireAuth, listInbodyReports);

router.get("/inbody/reports/:id", requireAuth, getInbodyReport);

export default router;

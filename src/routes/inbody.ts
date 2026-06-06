/**
 * InBody Routes
 * -------------
 * Mounts:
 *   POST   /api/inbody/upload              — Upload + OCR + AI analyse a report
 *   POST   /api/inbody/analyze/:reportId   — Re-run AI on an existing report
 *   GET    /api/inbody/reports             — List user's reports
 *   GET    /api/inbody/reports/:id         — Get a single report
 *   DELETE /api/inbody/reports/:id         — Delete a report + its storage file
 */

import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../lib/auth";
import {
  uploadInbodyReport,
  analyzeInbodyReport,
  listInbodyReports,
  getInbodyReport,
  deleteInbodyReport,
} from "../controllers/inbodyController";

const router = Router();

// ── Multer: in-memory storage, max 10 MB ──────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
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

// ── DELETE /api/inbody/reports/:id ────────────────────────────────────────────
router.delete("/inbody/reports/:id", requireAuth, deleteInbodyReport);

export default router;

/**
 * InBody Controller
 * -----------------
 * Thin HTTP layer — validates request inputs, delegates to inbodyService,
 * and maps service results / errors to HTTP responses.
 *
 * Endpoints:
 *   POST   /api/inbody/upload              Upload + OCR + AI analyse
 *   POST   /api/inbody/analyze/:reportId   Re-run AI on existing report
 *   GET    /api/inbody/reports             List user's reports
 *   GET    /api/inbody/reports/:id         Get single report
 *   DELETE /api/inbody/reports/:id         Delete report + storage file
 */

import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  createReport,
  reanalyzeReport,
  listReports,
  getReportById,
  deleteReport,
  isValidUUID,
} from "../services/inbodyService";

// ─── Allowed upload MIME types ────────────────────────────────────────────────
const ALLOWED_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

// ─── Shared error-to-HTTP mapping ─────────────────────────────────────────────
function handleServiceError(err: unknown, res: Response): Response {
  const e = err as any;
  if (e?.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, message: "Report not found" });
  }
  if (e?.code === "FORBIDDEN") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  if (e?.code === "NO_METRICS") {
    return res.status(400).json({
      success: false,
      message: "No extracted metrics available. Upload a report first.",
    });
  }
  logger.error({ err }, "Unhandled service error");
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// ─── POST /api/inbody/upload ──────────────────────────────────────────────────
export async function uploadInbodyReport(
  req: AuthenticatedRequest,
  res: Response,
) {
  const userId = req.auth!.sub;
  const file = (req as any).file as Express.Multer.File | undefined;

  if (!file) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded. Send a multipart/form-data request with field name 'report'.",
    });
  }

  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return res.status(415).json({
      success: false,
      message: `Unsupported file type: ${file.mimetype}. Allowed: PDF, JPG, PNG, WebP, HEIC.`,
    });
  }

  try {
    const result = await createReport(userId, file);

    // If storage failed but OCR/AI succeeded, return 207 (Partial Success)
    if (result.storageError) {
      return res.status(207).json({
        success: true,
        ...result,
        warnings: [
          `Report processed successfully but file could not be saved to storage: ${result.storageError}. ` +
          `Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ensure the 'inbody-reports' bucket exists (run: pnpm setup-storage).`,
        ],
      });
    }

    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return handleServiceError(err, res);
  }
}

// ─── POST /api/inbody/analyze/:reportId ───────────────────────────────────────
export async function analyzeInbodyReport(
  req: AuthenticatedRequest,
  res: Response,
) {
  const userId = req.auth!.sub;
  const reportId = String(req.params.reportId);

  if (!isValidUUID(reportId)) {
    return res.status(400).json({ success: false, message: "Invalid report ID format" });
  }

  try {
    const analysis = await reanalyzeReport(reportId, userId);
    return res.json({ success: true, reportId, analysis });
  } catch (err) {
    return handleServiceError(err, res);
  }
}

// ─── GET /api/inbody/reports ──────────────────────────────────────────────────
export async function listInbodyReports(
  req: AuthenticatedRequest,
  res: Response,
) {
  const userId = req.auth!.sub;
  try {
    const reports = await listReports(userId);
    return res.json({ success: true, reports });
  } catch (err) {
    return handleServiceError(err, res);
  }
}

// ─── GET /api/inbody/reports/:id ─────────────────────────────────────────────
export async function getInbodyReport(
  req: AuthenticatedRequest,
  res: Response,
) {
  const userId = req.auth!.sub;
  const id = String(req.params.id);

  if (!isValidUUID(id)) {
    return res.status(400).json({ success: false, message: "Invalid report ID format" });
  }

  try {
    const report = await getReportById(id, userId);
    return res.json({ success: true, report });
  } catch (err) {
    return handleServiceError(err, res);
  }
}

// ─── DELETE /api/inbody/reports/:id ──────────────────────────────────────────
export async function deleteInbodyReport(
  req: AuthenticatedRequest,
  res: Response,
) {
  const userId = req.auth!.sub;
  const id = String(req.params.id);

  // Validate UUID format before hitting the database
  if (!isValidUUID(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid report ID format",
    });
  }

  try {
    await deleteReport(id, userId);
    return res.status(200).json({
      success: true,
      message: "Report deleted successfully",
    });
  } catch (err) {
    return handleServiceError(err, res);
  }
}

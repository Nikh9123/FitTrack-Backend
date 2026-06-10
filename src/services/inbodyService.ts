/**
 * InBody Service
 * --------------
 * Pure business logic — no HTTP concerns (no req/res).
 * All database queries and Supabase Storage interactions live here.
 */

import { db, inbodyReports, measurementLogs, userProfiles } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { estimateBodyComposition } from "../lib/body-estimation";
import { lbToKg, feetInchesToCm } from "../lib/unit-convert";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";
import { uploadToStorage, runOCR } from "../lib/inbody-ocr";
import { isValidExtraction } from "../lib/inbody-parser";
import { analyzeWithGemini, type GeminiAnalysis } from "../lib/gemini";
import ws from "ws";

// ─── Supabase Storage client (service-role key for delete) ───────────────────
const storageClient = createClient(
  process.env.SUPABASE_URL ?? "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    "placeholder",
  {
    global: {
      fetch: (url, options) => fetch(url, { ...options, duplex: "half" } as RequestInit),
    },
    realtime: {
      transport: ws,
    },
  }
);

const STORAGE_BUCKET = "inbody-reports";

// ─── UUID validation ──────────────────────────────────────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id);
}

// ─── Transient DB retry helper ────────────────────────────────────────────────
const TRANSIENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);

function isTransientDbError(err: unknown): boolean {
  const e = err as any;
  const cause = e?.cause;
  const msg = `${e?.message ?? ""} ${cause?.message ?? ""}`;
  const code = e?.code ?? cause?.code;
  return (
    TRANSIENT_CODES.has(code) ||
    [...TRANSIENT_CODES].some((c) => msg.includes(c))
  );
}

async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isTransientDbError(err) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, attempt * 500));
    }
  }
  throw last;
}

// ─── Extract storage path from a Supabase public URL ─────────────────────────
function extractStoragePath(url: string): string | null {
  try {
    // Supabase public URLs look like:
    // https://<ref>.supabase.co/storage/v1/object/public/<bucket>/<path>
    const match = url.match(/\/object\/public\/[^/]+\/(.+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ─── Service methods ──────────────────────────────────────────────────────────

/** Upload, OCR, AI-analyse, and persist an InBody report. */
export async function createReport(
  userId: string,
  file: Express.Multer.File,
): Promise<{
  reportId: string;
  extractedMetrics: Record<string, string>;
  extractedText: string;
  geminiAnalysis: GeminiAnalysis | null;
  storageError?: string;  // set when file upload failed but report still processed
}> {
  // 1. Insert a "processing" row first so we have an ID
  const reportId = await withDbRetry(async () => {
    const [row] = await db
      .insert(inbodyReports)
      .values({
        userId,
        reportUrl: "",
        fileType: file.mimetype,
        fileName: file.originalname,
        status: "processing",
      })
      .returning({ id: inbodyReports.id });
    return row.id;
  });

  // 2. Attempt to upload file to Supabase Storage (non-fatal — OCR always runs)
  let reportUrl = "";
  let storageError: string | undefined;
  try {
    reportUrl = await uploadToStorage(
      file.buffer,
      file.mimetype,
      userId,
      file.originalname,
    );
    logger.info({ reportId, reportUrl }, "File uploaded to storage");
  } catch (err: any) {
    storageError = err.message as string;
    logger.warn(
      { reportId, err: err.message },
      "Storage upload failed — continuing with OCR and AI analysis without a stored file URL",
    );
    // Mark the DB row to reflect the storage warning, but keep status as "processing"
    await db
      .update(inbodyReports)
      .set({ errorMessage: `Storage unavailable: ${err.message}`, updatedAt: new Date() })
      .where(eq(inbodyReports.id, reportId))
      .catch((dbErr) => logger.warn({ dbErr }, "Could not persist storage warning"));
  }

  // 3. OCR
  let rawText: string;
  let extractedMetrics: Record<string, string>;
  try {
    const result = await runOCR(file.buffer, file.mimetype, file.originalname);
    rawText = result.rawText;
    extractedMetrics = result.metrics as Record<string, string>;
  } catch (err: any) {
    await db
      .update(inbodyReports)
      .set({
        reportUrl,
        status: "failed",
        errorMessage: `OCR failed: ${err.message}`,
        updatedAt: new Date(),
      })
      .where(eq(inbodyReports.id, reportId));
    throw err;
  }

  if (!isValidExtraction(extractedMetrics)) {
    logger.warn({ reportId, metricCount: Object.keys(extractedMetrics).length }, "Low-quality extraction");
  }

  // 4. AI analysis (non-fatal)
  const userProfile = {
    age: extractedMetrics.age ? parseInt(extractedMetrics.age, 10) : undefined,
    gender: extractedMetrics.gender,
    height: extractedMetrics.height,
  };

  let geminiAnalysis: GeminiAnalysis | null = null;
  try {
    geminiAnalysis = await analyzeWithGemini(extractedMetrics, userProfile, rawText);
  } catch (err: any) {
    logger.warn({ err: err.message, reportId }, "AI analysis failed — continuing without it");
  }

  // 5. Persist final results
  await db
    .update(inbodyReports)
    .set({
      reportUrl,
      extractedText: rawText,
      extractedMetrics,
      geminiAnalysis: geminiAnalysis ?? undefined,
      status: "done",
      updatedAt: new Date(),
    })
    .where(eq(inbodyReports.id, reportId));

  return {
    reportId,
    extractedMetrics,
    extractedText: rawText,
    geminiAnalysis,
    ...(storageError ? { storageError } : {}),
  };
}

export interface EstimateMeasurementsInput {
  weightKg?: number;
  weightLb?: number;
  heightCm?: number;
  heightFeet?: number;
  heightInches?: number;
  waistCm: number;
  chestCm: number;
}

/** Create an estimated InBody report from body measurements. */
export async function createEstimatedReport(
  userId: string,
  input: EstimateMeasurementsInput,
): Promise<{
  reportId: string;
  extractedMetrics: Record<string, string>;
  geminiAnalysis: GeminiAnalysis | null;
}> {
  let weightKg = input.weightKg;
  if (weightKg == null && input.weightLb != null) {
    weightKg = lbToKg(input.weightLb);
  }

  let heightCm = input.heightCm;
  if (heightCm == null && input.heightFeet != null) {
    heightCm = feetInchesToCm(input.heightFeet, input.heightInches ?? 0);
  }

  if (!weightKg || weightKg <= 0 || !heightCm || heightCm <= 0) {
    throw { code: "INVALID_INPUT", message: "Valid weight and height are required" };
  }
  if (!input.waistCm || input.waistCm <= 0) {
    throw { code: "INVALID_INPUT", message: "Waist measurement is required" };
  }

  const [profile] = await db
    .select({
      gender: userProfiles.gender,
      dateOfBirth: userProfiles.dateOfBirth,
      heightCm: userProfiles.heightCm,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const genderRaw = (profile?.gender ?? "male").toLowerCase();
  const gender: "male" | "female" = genderRaw.startsWith("f") ? "female" : "male";

  let age = 30;
  if (profile?.dateOfBirth) {
    const dob = new Date(profile.dateOfBirth);
    const now = new Date();
    age = now.getFullYear() - dob.getFullYear();
  }

  const metrics = estimateBodyComposition({
    weightKg,
    heightCm,
    waistCm: input.waistCm,
    chestCm: input.chestCm ?? 0,
    age,
    gender,
  });

  const extractedMetrics: Record<string, string> = {
    ...metrics,
    estimated: "true",
  };

  let geminiAnalysis: GeminiAnalysis | null = null;
  try {
    geminiAnalysis = await analyzeWithGemini(extractedMetrics, {
      age,
      gender,
      height: metrics.height,
    });
    if (geminiAnalysis && typeof geminiAnalysis === "object") {
      (geminiAnalysis as unknown as Record<string, unknown>).estimated = true;
    }
  } catch (err: any) {
    logger.warn({ err: err.message, userId }, "AI narrative for estimated report failed");
  }

  const [row] = await db
    .insert(inbodyReports)
    .values({
      userId,
      reportUrl: null,
      fileType: "estimated",
      fileName: "body-measurements",
      extractedMetrics,
      geminiAnalysis: geminiAnalysis ?? undefined,
      sourceType: "estimated",
      status: "done",
      extractedText: "Estimated from body measurements (not clinically accurate).",
    })
    .returning({ id: inbodyReports.id });

  await db.insert(measurementLogs).values({
    userId,
    recordedAt: new Date(),
    waistCm: String(input.waistCm),
    chestCm: input.chestCm ? String(input.chestCm) : null,
  });

  return {
    reportId: row.id,
    extractedMetrics,
    geminiAnalysis,
  };
}

/** Re-run AI analysis on an already-uploaded report and persist results. */
export async function reanalyzeReport(
  reportId: string,
  userId: string,
): Promise<GeminiAnalysis> {
  const [report] = await db
    .select()
    .from(inbodyReports)
    .where(eq(inbodyReports.id, reportId))
    .limit(1);

  if (!report) throw { code: "NOT_FOUND" };
  if (report.userId !== userId) throw { code: "FORBIDDEN" };
  if (!report.extractedMetrics) throw { code: "NO_METRICS" };

  const metrics = report.extractedMetrics as Record<string, string>;
  const rawText = report.extractedText ?? "";

  const [profile] = await db
    .select({
      gender: userProfiles.gender,
      heightCm: userProfiles.heightCm,
      dateOfBirth: userProfiles.dateOfBirth,
      fitnessGoal: userProfiles.fitnessGoal,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  let age: number | undefined;
  if (metrics.age) {
    age = parseInt(metrics.age, 10);
  } else if (profile?.dateOfBirth) {
    const dob = new Date(profile.dateOfBirth);
    age = new Date().getFullYear() - dob.getFullYear();
  }

  const userProfile = {
    age,
    gender: metrics.gender ?? profile?.gender ?? undefined,
    height: metrics.height ?? (profile?.heightCm ? String(profile.heightCm) : undefined),
    fitnessGoal: profile?.fitnessGoal ?? undefined,
  };

  const geminiAnalysis = await analyzeWithGemini(metrics, userProfile, rawText);

  await db
    .update(inbodyReports)
    .set({
      geminiAnalysis,
      updatedAt: new Date(),
    })
    .where(eq(inbodyReports.id, reportId));

  logger.info({ reportId, userId, source: geminiAnalysis.__aiSource }, "InBody AI analysis persisted");

  return geminiAnalysis;
}

/** Return all reports for a user, newest first. */
export async function listReports(userId: string) {
  return db
    .select({
      id: inbodyReports.id,
      reportUrl: inbodyReports.reportUrl,
      fileType: inbodyReports.fileType,
      fileName: inbodyReports.fileName,
      status: inbodyReports.status,
      extractedMetrics: inbodyReports.extractedMetrics,
      geminiAnalysis: inbodyReports.geminiAnalysis,
      sourceType: inbodyReports.sourceType,
      createdAt: inbodyReports.createdAt,
    })
    .from(inbodyReports)
    .where(eq(inbodyReports.userId, userId))
    .orderBy(desc(inbodyReports.createdAt));
}

/** Return a single report by ID, enforcing ownership. */
export async function getReportById(reportId: string, userId: string) {
  const [report] = await db
    .select()
    .from(inbodyReports)
    .where(eq(inbodyReports.id, String(reportId)))
    .limit(1);

  if (!report) throw { code: "NOT_FOUND" };
  if (report.userId !== userId) throw { code: "FORBIDDEN" };

  return report;
}

/**
 * Delete a report row and its associated file from Supabase Storage.
 *
 * Guards:
 *  - UUID format validation (done in controller before calling this)
 *  - Report must exist
 *  - Report must belong to the requesting user
 *  - Storage file is removed before DB row (fail-safe: logs warning if storage delete fails)
 */
export async function deleteReport(
  reportId: string,
  userId: string,
): Promise<void> {
  // 1. Fetch the report to verify it exists and is owned by this user
  const [report] = await db
    .select({
      id: inbodyReports.id,
      userId: inbodyReports.userId,
      reportUrl: inbodyReports.reportUrl,
    })
    .from(inbodyReports)
    .where(and(eq(inbodyReports.id, reportId)))
    .limit(1);

  if (!report) throw { code: "NOT_FOUND" };
  if (report.userId !== userId) throw { code: "FORBIDDEN" };

  // 2. Attempt to delete the file from Supabase Storage (non-fatal)
  if (report.reportUrl) {
    const storagePath = extractStoragePath(report.reportUrl);
    if (storagePath) {
      const { error } = await storageClient.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);
      if (error) {
        // Log but don't block — DB row must still be deleted
        logger.warn(
          { reportId, storagePath, err: error.message },
          "Storage file deletion failed — continuing with DB delete",
        );
      } else {
        logger.info({ reportId, storagePath }, "Storage file deleted");
      }
    } else {
      logger.warn(
        { reportId, reportUrl: report.reportUrl },
        "Could not extract storage path — skipping file deletion",
      );
    }
  }

  // 3. Delete the DB row (cascades to any FK-linked rows via ON DELETE CASCADE)
  const deleted = await db
    .delete(inbodyReports)
    .where(
      and(
        eq(inbodyReports.id, reportId),
        eq(inbodyReports.userId, userId), // double-check ownership at DB level
      ),
    )
    .returning({ id: inbodyReports.id });

  if (deleted.length === 0) {
    // Race condition — already deleted between our SELECT and DELETE
    throw { code: "NOT_FOUND" };
  }

  logger.info({ reportId, userId }, "InBody report deleted");
}
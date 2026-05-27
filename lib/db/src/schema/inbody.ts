import { InferModel, relations } from "drizzle-orm";
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { users } from "./users";

// ─── InBody Reports Table ─────────────────────────────────────────────────────
export const inbodyReports = pgTable("inbody_reports", {
  id: uuid("id").defaultRandom().primaryKey(),

  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  /** Public URL of the uploaded file (image / PDF) stored in Supabase Storage */
  reportUrl: text("report_url").notNull(),

  /** MIME type: "image/jpeg", "image/png", "application/pdf", etc. */
  fileType: text("file_type").notNull().default("image/jpeg"),

  /** Original filename from the client */
  fileName: text("file_name"),

  /** Raw text extracted by OCR */
  extractedText: text("extracted_text"),

  /**
   * Structured metrics JSON returned by the OCR parser.
   * Shape: { weight, bmi, bodyFat, skeletalMuscleMass, leanBodyMass,
   *           protein, bodyWater, bmr, visceralFat, metabolicAge,
   *           waistHipRatio }
   */
  extractedMetrics: jsonb("extracted_metrics"),

  /** Processing status: "pending" | "processing" | "done" | "failed" */
  status: text("status").notNull().default("pending"),

  /** Human-readable error message when status === "failed" */
  errorMessage: text("error_message"),

  /**
   * Gemini AI analysis result (JSON).
   * Contains: overallSummary, fitnessLevel, bodyFatAnalysis, muscleMassAnalysis,
   *           metabolismInsights, visceralFatAnalysis, strengths, weaknesses,
   *           healthRisks, recommendations, workoutPlan, dietPlan, goalSuggestions
   */
  geminiAnalysis: jsonb("gemini_analysis"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const inbodyReportsRelations = relations(inbodyReports, ({ one }) => ({
  user: one(users, {
    fields: [inbodyReports.userId],
    references: [users.id],
  }),
}));

// ─── Types ────────────────────────────────────────────────────────────────────
export type InbodyReport = InferModel<typeof inbodyReports>;

export const insertInbodyReportSchema = createInsertSchema(inbodyReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// ─── Extracted Metrics shape (for TypeScript consumers) ────────────────────────
export interface ExtractedInBodyMetrics {
  weight?: string;
  bmi?: string;
  bodyFat?: string;
  skeletalMuscleMass?: string;
  leanBodyMass?: string;
  protein?: string;
  bodyWater?: string;
  bmr?: string;
  visceralFat?: string;
  metabolicAge?: string;
  waistHipRatio?: string;
}

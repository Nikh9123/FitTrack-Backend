import { InferModel } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { aiRequestStatus, aiRequestType } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const aiPlanRequests = pgTable("ai_plan_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  gymId: uuid("gym_id").references(() => gyms.id),
  requestType: aiRequestType("request_type").notNull(),
  prompt: text("prompt"),
  inputPayload: jsonb("input_payload"),
  status: aiRequestStatus("status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const aiPlanResponses = pgTable("ai_plan_responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => aiPlanRequests.id, { onDelete: "cascade" }),
  responsePayload: jsonb("response_payload").notNull(),
  score: numeric("score"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiRecommendationFeedback = pgTable("ai_recommendation_feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  gymId: uuid("gym_id").references(() => gyms.id),
  recommendationId: uuid("recommendation_id"),
  rating: integer("rating"),
  comments: text("comments"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AiPlanRequest = InferModel<typeof aiPlanRequests>;
export type AiPlanResponse = InferModel<typeof aiPlanResponses>;
export type AiRecommendationFeedback = InferModel<typeof aiRecommendationFeedback>;

export const insertAiPlanRequestSchema = createInsertSchema(aiPlanRequests).omit({ id: true, createdAt: true });
export const insertAiPlanResponseSchema = createInsertSchema(aiPlanResponses).omit({ id: true, createdAt: true });
export const insertAiRecommendationFeedbackSchema = createInsertSchema(aiRecommendationFeedback).omit({ id: true, createdAt: true });

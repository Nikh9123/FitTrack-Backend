import { InferModel } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { gyms } from "./gyms";
import { users } from "./users";

export const gymReviews = pgTable(
  "gym_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    title: text("title"),
    comment: text("comment"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymIndex: index("gym_reviews_gym_id_idx").on(table.gymId),
    userIndex: index("gym_reviews_user_id_idx").on(table.userId),
  }),
);

export const trainerReviews = pgTable(
  "trainer_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trainerUserId: uuid("trainer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id").references(() => gyms.id),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    trainerIndex: index("trainer_reviews_trainer_user_id_idx").on(table.trainerUserId),
    gymIndex: index("trainer_reviews_gym_id_idx").on(table.gymId),
  }),
);

export const reviewHelpful = pgTable(
  "review_helpful",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reviewId: uuid("review_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    isHelpful: boolean("is_helpful").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    reviewUserUnique: uniqueIndex("review_helpful_review_user_idx").on(table.reviewId, table.userId),
  }),
);

export type GymReview = InferModel<typeof gymReviews>;
export type TrainerReview = InferModel<typeof trainerReviews>;
export type ReviewHelpful = InferModel<typeof reviewHelpful>;

export const insertGymReviewSchema = createInsertSchema(gymReviews).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTrainerReviewSchema = createInsertSchema(trainerReviews).omit({ id: true, createdAt: true });
export const insertReviewHelpfulSchema = createInsertSchema(reviewHelpful).omit({ id: true, createdAt: true });

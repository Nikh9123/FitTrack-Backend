import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  integer,
  numeric,
  index,
  jsonb,
  type AnyPgColumn,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { difficultyLevel, fitnessLevel, planStatus, workoutSessionStatus, variationType } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const exerciseCategories = pgTable("exercise_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  parentId: uuid("parent_id").references((): AnyPgColumn => exerciseCategories.id),
});

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => exerciseCategories.id),
    slug: text("slug"),
    aliases: text("aliases").array(),
    bodyPart: text("body_part"),
    primaryMuscle: text("primary_muscle"),
    targetMuscle: text("target_muscle"),
    secondaryMuscle: text("secondary_muscle"),
    secondaryMuscles: text("secondary_muscles").array(),
    equipment: text("equipment").array(),
    difficulty: difficultyLevel("difficulty"),
    mechanics: text("mechanics"),
    forceType: text("force_type"),
    instructions: text("instructions"),
    tips: text("tips").array(),
    useCases: jsonb("use_cases"),
    contraindications: text("contraindications").array(),
    gifUrl: text("gif_url"),
    imageUrl: text("image_url"),
    videoUrl: text("video_url"),
    youtubeUrl: text("youtube_url"),
    source: text("source"),
    sourceExerciseId: text("source_exercise_id"),
    media: jsonb("media"),
    isPublic: boolean("is_public").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameIndex: index("exercises_name_idx").on(table.name),
    slugIndex: uniqueIndex("exercises_slug_idx").on(table.slug),
    categoryIndex: index("exercises_category_id_idx").on(table.categoryId),
    bodyPartIndex: index("exercises_body_part_idx").on(table.bodyPart),
    targetMuscleIndex: index("exercises_target_muscle_idx").on(table.targetMuscle),
    sourceExerciseIndex: uniqueIndex("exercises_source_exercise_idx").on(table.source, table.sourceExerciseId),
  }),
);

export const workoutPlanTemplates = pgTable(
  "workout_plan_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    level: fitnessLevel("level").notNull().default("beginner"),
    durationWeeks: integer("duration_weeks").notNull().default(4),
    status: planStatus("status").notNull().default("draft"),
    isPublic: boolean("is_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymIndex: index("workout_plan_templates_gym_id_idx").on(table.gymId),
    statusIndex: index("workout_plan_templates_status_idx").on(table.status),
  }),
);

export const workoutPlanDays = pgTable(
  "workout_plan_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    planTemplateId: uuid("plan_template_id").notNull().references(() => workoutPlanTemplates.id, { onDelete: "cascade" }),
    dayIndex: integer("day_index").notNull(),
    name: text("name"),
    notes: text("notes"),
  },
  (table) => ({
    planDayIndex: uniqueIndex("workout_plan_days_plan_day_idx").on(table.planTemplateId, table.dayIndex),
  }),
);

export const workoutPlanItems = pgTable("workout_plan_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  planDayId: uuid("plan_day_id").notNull().references(() => workoutPlanDays.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  orderIndex: integer("order_index").notNull(),
  sets: integer("sets"),
  reps: text("reps"),
  restSeconds: integer("rest_seconds"),
  tempo: text("tempo"),
  weightKg: numeric("weight_kg"),
  notes: text("notes"),
});

export const memberWorkoutPlans = pgTable(
  "member_workout_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => users.id),
    templateId: uuid("template_id").references(() => workoutPlanTemplates.id),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    status: planStatus("status").notNull().default("active"),
    progressPercent: numeric("progress_percent").default("0"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("member_workout_plans_user_id_idx").on(table.userId),
    statusIndex: index("member_workout_plans_status_idx").on(table.status),
  }),
);

export const workoutSessions = pgTable(
  "workout_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id").references(() => users.id),
    sessionDate: timestamp("session_date", { withTimezone: true }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }),
    endTime: timestamp("end_time", { withTimezone: true }),
    planId: uuid("plan_id").references(() => workoutPlanTemplates.id),
    notes: text("notes"),
    status: workoutSessionStatus("status").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("workout_sessions_user_id_idx").on(table.userId),
    trainerIndex: index("workout_sessions_trainer_user_id_idx").on(table.trainerUserId),
    sessionDateIndex: index("workout_sessions_session_date_idx").on(table.sessionDate),
  }),
);

export const workoutSessionItems = pgTable("workout_session_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => workoutSessions.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  orderIndex: integer("order_index").notNull(),
  sets: integer("sets"),
  reps: integer("reps"),
  weightKg: numeric("weight_kg"),
  durationSeconds: integer("duration_seconds"),
  notes: text("notes"),
});

export const exerciseProgress = pgTable("exercise_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  oneRepMaxKg: text("one_rep_max_kg"),
  bestSets: integer("best_sets"),
  bestReps: integer("best_reps"),
  notes: text("notes"),
});

export const exerciseVariations = pgTable(
  "exercise_variations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    exerciseId: uuid("exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    variationExerciseId: uuid("variation_exercise_id").notNull().references(() => exercises.id, { onDelete: "cascade" }),
    relationType: variationType("relation_type").notNull(),
  },
  (table) => ({
    uniqueVariation: uniqueIndex("exercise_variations_exercise_variation_idx").on(table.exerciseId, table.variationExerciseId),
  }),
);

export const workoutsRelations = relations(workoutSessions, ({ many }) => ({
  items: many(workoutSessionItems),
}));

export type ExerciseCategory = InferModel<typeof exerciseCategories>;
export type Exercise = InferModel<typeof exercises>;
export type WorkoutPlanTemplate = InferModel<typeof workoutPlanTemplates>;
export type WorkoutPlanDay = InferModel<typeof workoutPlanDays>;
export type WorkoutPlanItem = InferModel<typeof workoutPlanItems>;
export type MemberWorkoutPlan = InferModel<typeof memberWorkoutPlans>;
export type WorkoutSession = InferModel<typeof workoutSessions>;
export type WorkoutSessionItem = InferModel<typeof workoutSessionItems>;
export type ExerciseProgress = InferModel<typeof exerciseProgress>;
export type ExerciseVariation = InferModel<typeof exerciseVariations>;

export const insertExerciseCategorySchema = createInsertSchema(exerciseCategories).omit({ id: true });
export const insertExerciseSchema = createInsertSchema(exercises).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkoutPlanTemplateSchema = createInsertSchema(workoutPlanTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkoutPlanDaySchema = createInsertSchema(workoutPlanDays).omit({ id: true });
export const insertWorkoutPlanItemSchema = createInsertSchema(workoutPlanItems).omit({ id: true });
export const insertMemberWorkoutPlanSchema = createInsertSchema(memberWorkoutPlans).omit({ id: true, assignedAt: true });
export const insertWorkoutSessionSchema = createInsertSchema(workoutSessions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertWorkoutSessionItemSchema = createInsertSchema(workoutSessionItems).omit({ id: true });
export const insertExerciseProgressSchema = createInsertSchema(exerciseProgress).omit({ id: true, recordedAt: true });
export const insertExerciseVariationSchema = createInsertSchema(exerciseVariations).omit({ id: true });

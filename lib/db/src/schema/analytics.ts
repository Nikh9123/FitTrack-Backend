import { InferModel, relations } from "drizzle-orm";
import {
  integer,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import {
  activitySourceType,
  deviceConnectionStatus,
  goalStatus,
  goalType,
  privacyLevel,
  progressPhotoType,
  streakType,
} from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";
import { files } from "./files";

export const bodyCompositionReports = pgTable("body_composition_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  reportDate: timestamp("report_date", { withTimezone: true }).notNull(),
  weightKg: numeric("weight_kg"),
  bodyFatPercent: numeric("body_fat_percent"),
  muscleMassKg: numeric("muscle_mass_kg"),
  visceralFat: numeric("visceral_fat"),
  bmi: numeric("bmi"),
  waistCm: numeric("waist_cm"),
  otherMetrics: jsonb("other_metrics"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  fileId: uuid("file_id").references(() => files.id),
});

export const weightLogs = pgTable("weight_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  weightKg: numeric("weight_kg").notNull(),
  notes: text("notes"),
});

export const measurementLogs = pgTable("measurement_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  neckCm: text("neck_cm"),
  waistCm: text("waist_cm"),
  hipsCm: text("hips_cm"),
  chestCm: text("chest_cm"),
  thighCm: text("thigh_cm"),
  armCm: text("arm_cm"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const progressPhotos = pgTable(
  "progress_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id").references(() => gyms.id),
    photoType: progressPhotoType("photo_type").notNull(),
    fileId: uuid("file_id").notNull().references(() => files.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    notes: text("notes"),
    privacyLevel: privacyLevel("privacy_level").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("progress_photos_user_id_idx").on(table.userId),
    takenAtIndex: index("progress_photos_taken_at_idx").on(table.takenAt),
  }),
);

export const connectedFitnessDevices = pgTable(
  "connected_fitness_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: activitySourceType("provider").notNull(),
    deviceName: text("device_name").notNull(),
    externalDeviceId: text("external_device_id"),
    status: deviceConnectionStatus("status").notNull().default("connected"),
    scopes: jsonb("scopes"),
    metadata: jsonb("metadata"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    userProviderIndex: index("connected_fitness_devices_user_provider_idx").on(table.userId, table.provider),
    statusIndex: index("connected_fitness_devices_status_idx").on(table.status),
  }),
);

export const activitySummaries = pgTable(
  "activity_summaries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceDeviceId: uuid("source_device_id").references(() => connectedFitnessDevices.id, { onDelete: "set null" }),
    sourceType: activitySourceType("source_type").notNull().default("manual"),
    summaryDate: timestamp("summary_date", { withTimezone: true }).notNull(),
    steps: integer("steps").notNull().default(0),
    walkingMinutes: integer("walking_minutes").notNull().default(0),
    runningMinutes: integer("running_minutes").notNull().default(0),
    sleepMinutes: integer("sleep_minutes").notNull().default(0),
    caloriesBurned: integer("calories_burned").notNull().default(0),
    distanceMeters: integer("distance_meters").notNull().default(0),
    rawPayload: jsonb("raw_payload"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDateIndex: index("activity_summaries_user_date_idx").on(table.userId, table.summaryDate),
    sourceIndex: index("activity_summaries_source_idx").on(table.sourceType),
  }),
);

export const achievementDefinitions = pgTable("achievement_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: streakType("type").notNull(),
  criteria: jsonb("criteria").notNull(),
  points: integer("points").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const userAchievements = pgTable("user_achievements", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gymId: uuid("gym_id").references(() => gyms.id),
  achievementId: uuid("achievement_id").notNull().references(() => achievementDefinitions.id, { onDelete: "cascade" }),
  earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb("meta"),
});

export const userStreaks = pgTable(
  "user_streaks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id").references(() => gyms.id),
    type: streakType("type").notNull(),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("user_streaks_user_id_idx").on(table.userId),
  }),
);

export const analyticsSnapshots = pgTable("analytics_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
  snapshotDate: timestamp("snapshot_date", { withTimezone: true }).notNull(),
  metricName: text("metric_name").notNull(),
  metricValue: numeric("metric_value").notNull(),
  dimensions: jsonb("dimensions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id").references(() => gyms.id),
    goalType: goalType("goal_type").notNull(),
    targetValue: numeric("target_value").notNull(),
    unit: text("unit").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }),
    status: goalStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("goals_user_id_idx").on(table.userId),
    statusIndex: index("goals_status_idx").on(table.status),
  }),
);

export const analyticsRelations = relations(userAchievements, ({ one }) => ({
  achievement: one(achievementDefinitions, {
    fields: [userAchievements.achievementId],
    references: [achievementDefinitions.id],
  }),
}));

export type BodyCompositionReport = InferModel<typeof bodyCompositionReports>;
export type WeightLog = InferModel<typeof weightLogs>;
export type MeasurementLog = InferModel<typeof measurementLogs>;
export type ProgressPhoto = InferModel<typeof progressPhotos>;
export type ConnectedFitnessDevice = InferModel<typeof connectedFitnessDevices>;
export type ActivitySummary = InferModel<typeof activitySummaries>;
export type AchievementDefinition = InferModel<typeof achievementDefinitions>;
export type UserAchievement = InferModel<typeof userAchievements>;
export type UserStreak = InferModel<typeof userStreaks>;
export type AnalyticsSnapshot = InferModel<typeof analyticsSnapshots>;
export type Goal = InferModel<typeof goals>;

export const insertBodyCompositionReportSchema = createInsertSchema(bodyCompositionReports).omit({ id: true, uploadedAt: true });
export const insertWeightLogSchema = createInsertSchema(weightLogs).omit({ id: true });
export const insertMeasurementLogSchema = createInsertSchema(measurementLogs).omit({ id: true, createdAt: true });
export const insertProgressPhotoSchema = createInsertSchema(progressPhotos).omit({ id: true, createdAt: true });
export const insertConnectedFitnessDeviceSchema = createInsertSchema(connectedFitnessDevices).omit({ id: true, connectedAt: true });
export const insertActivitySummarySchema = createInsertSchema(activitySummaries).omit({ id: true, syncedAt: true });
export const insertAchievementDefinitionSchema = createInsertSchema(achievementDefinitions).omit({ id: true });
export const insertUserAchievementSchema = createInsertSchema(userAchievements).omit({ id: true, earnedAt: true });
export const insertUserStreakSchema = createInsertSchema(userStreaks).omit({ id: true, calculatedAt: true });
export const insertAnalyticsSnapshotSchema = createInsertSchema(analyticsSnapshots).omit({ id: true, createdAt: true });
export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true, updatedAt: true });

// ─── Daily Check-ins ──────────────────────────────────────────────────────────

export const dailyCheckins = pgTable(
  "daily_checkins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    checkinDate: timestamp("checkin_date", { withTimezone: true }).notNull(),
    energyLevel: integer("energy_level"),
    sleepHours: numeric("sleep_hours"),
    soreness: integer("soreness"),
    mood: integer("mood"),
    recoveryScore: integer("recovery_score"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDateIndex: index("daily_checkins_user_date_idx").on(table.userId, table.checkinDate),
  }),
);

export type DailyCheckin = InferModel<typeof dailyCheckins>;
export const insertDailyCheckinSchema = createInsertSchema(dailyCheckins).omit({ id: true, createdAt: true });

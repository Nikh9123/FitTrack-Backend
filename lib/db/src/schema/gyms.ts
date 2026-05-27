import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  billingCycleType,
  gymStatus,
  locationStatus,
  paymentMethodType,
  planStatus,
  promotionStatus,
  promotionType,
  roleType,
  trainerStatus,
} from "./lookups";
import { roles, users } from "./users";

export const gyms = pgTable(
  "gyms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    currency: text("currency").notNull().default("INR"),
    billingCycle: billingCycleType("billing_cycle").notNull().default("monthly"),
    status: gymStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    slugIndex: uniqueIndex("gyms_slug_idx").on(table.slug),
    statusIndex: index("gyms_status_idx").on(table.status),
  }),
);

export const gymLocations = pgTable(
  "gym_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    postalCode: text("postal_code"),
    locationPoint: text("location_point"),
    tel: text("tel"),
    status: locationStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymIndex: index("gym_locations_gym_id_idx").on(table.gymId),
    statusIndex: index("gym_locations_status_idx").on(table.status),
  }),
);

export const gymSettings = pgTable(
  "gym_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymKeyIndex: uniqueIndex("gym_settings_gym_key_idx").on(table.gymId, table.key),
  }),
);

export const gymMembershipPlans = pgTable(
  "gym_membership_plans",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationDays: integer("duration_days"),
    priceCents: integer("price_cents").notNull(),
    billingCycle: billingCycleType("billing_cycle").notNull().default("monthly"),
    status: planStatus("status").notNull().default("active"),
    isTrial: boolean("is_trial").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymPlanIndex: index("gym_membership_plans_gym_id_idx").on(table.gymId),
  }),
);

export const gymTrainers = pgTable(
  "gym_trainers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    specialty: text("specialty"),
    ratingAvg: numeric("rating_avg").default("0"),
    totalReviews: integer("total_reviews").default(0),
    status: trainerStatus("status").notNull().default("active"),
  },
  (table) => ({
    gymTrainerUnique: uniqueIndex("gym_trainers_gym_user_idx").on(table.gymId, table.userId),
  }),
);

export const gymUserRoles = pgTable(
  "gym_user_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    assignedBy: uuid("assigned_by").references(() => users.id),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => ({
    uniqueRoleAssignment: uniqueIndex("gym_user_roles_gym_user_role_idx").on(table.gymId, table.userId, table.roleId),
    gymIndex: index("gym_user_roles_gym_id_idx").on(table.gymId),
    userIndex: index("gym_user_roles_user_id_idx").on(table.userId),
  }),
);

export const gymsRelations = relations(gyms, ({ many }) => ({
  locations: many(gymLocations),
  settings: many(gymSettings),
  membershipPlans: many(gymMembershipPlans),
  trainers: many(gymTrainers),
  userRoles: many(gymUserRoles),
}));

export type Gym = InferModel<typeof gyms>;
export type GymLocation = InferModel<typeof gymLocations>;
export type GymSetting = InferModel<typeof gymSettings>;
export type GymMembershipPlan = InferModel<typeof gymMembershipPlans>;
export type GymTrainer = InferModel<typeof gymTrainers>;
export type GymUserRole = InferModel<typeof gymUserRoles>;

export const insertGymSchema = createInsertSchema(gyms).omit({ id: true, createdAt: true, updatedAt: true, deletedAt: true });
export const insertGymLocationSchema = createInsertSchema(gymLocations).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGymSettingSchema = createInsertSchema(gymSettings).omit({ id: true });
export const insertGymMembershipPlanSchema = createInsertSchema(gymMembershipPlans).omit({ id: true, createdAt: true, updatedAt: true });
export const insertGymTrainerSchema = createInsertSchema(gymTrainers).omit({ id: true });
export const insertGymUserRoleSchema = createInsertSchema(gymUserRoles).omit({ id: true, assignedAt: true });

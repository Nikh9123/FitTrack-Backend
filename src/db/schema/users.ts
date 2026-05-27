import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createInsertSchema } from "drizzle-zod";

import {
  authTokenStatus,
  authTokenType,
  mfaType,
  roleType,
  userStatus,
} from "./lookups";

export const authProviderEnum = pgEnum("auth_provider", ["email", "google", "phone", "apple"]);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    name: roleType("name")
      .notNull()
      .unique(),

    description: text("description"),
  },
  (table) => ({
    nameIndex: uniqueIndex("roles_name_idx").on(
      table.name,
    ),
  }),
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    username: text("username").unique(),

    email: text("email")
      .notNull()
      .unique(),

    phone: text("phone"),

    passwordHash: text("password_hash"),

    status: userStatus("status")
      .notNull()
      .default("pending"),

    primaryRole: roleType("primary_role")
      .notNull()
      .default("member"),

    isEmailVerified: boolean("is_email_verified")
      .notNull()
      .default(false),

    isPhoneVerified: boolean("is_phone_verified")
      .notNull()
      .default(false),

    locale: text("locale"),

    timezone: text("timezone"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    usernameIndex: uniqueIndex("users_username_idx").on(
      table.username,
    ),

    phoneIndex: index("users_phone_idx").on(
      table.phone,
    ),

    statusIndex: index("users_status_idx").on(
      table.status,
    ),
  }),
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    firstName: text("first_name"),

    lastName: text("last_name"),

    gender: text("gender"),

    dateOfBirth: date("date_of_birth"),

    avatarUrl: text("avatar_url"),

    timezone: text("timezone"),

    locale: text("locale"),

    bio: text("bio"),

    // Auth provider that was used to create this account
    authProvider: authProviderEnum("auth_provider").default("email"),

    // Whether the user has completed the post-login setup wizard
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),

    // JSON blob of all data collected during onboarding
    onboardingData: jsonb("onboarding_data"),

    // Fitness metrics from onboarding
    heightCm: text("height_cm"),
    weightKg: text("weight_kg"),
    bmi: text("bmi"),
    bodyFatPercent: text("body_fat_percent"),
    fitnessGoal: text("fitness_goal"),
    activityLevel: text("activity_level"),
    dietaryPreference: text("dietary_preference"),
    workoutExperience: text("workout_experience"),
    region: text("region"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    deviceId: text("device_id"),

    ipAddress: text("ip_address"),

    userAgent: text("user_agent"),

    refreshTokenId: uuid("refresh_token_id"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    userIndex: index(
      "auth_sessions_user_id_idx",
    ).on(table.userId),

    expiresAtIndex: index(
      "auth_sessions_expires_at_idx",
    ).on(table.expiresAt),
  }),
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    tokenHash: text("token_hash")
      .notNull()
      .unique(),

    issuedAt: timestamp("issued_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    userIndex: index(
      "refresh_tokens_user_id_idx",
    ).on(table.userId),
  }),
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    tokenHash: text("token_hash").notNull(),

    type: authTokenType("type").notNull(),

    status: authTokenStatus("status")
      .notNull()
      .default("pending"),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),

    usedAt: timestamp("used_at", {
      withTimezone: true,
    }),
  },
);

export const mfaDevices = pgTable(
  "mfa_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    type: mfaType("type").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    verifiedAt: timestamp("verified_at", {
      withTimezone: true,
    }),

    lastUsedAt: timestamp("last_used_at", {
      withTimezone: true,
    }),

    isActive: boolean("is_active")
      .notNull()
      .default(true),
  },
);

export const usersRelations = relations(
  users,
  ({ one, many }) => ({
    profile: one(userProfiles, {
      fields: [users.id],
      references: [userProfiles.userId],
    }),

    sessions: many(authSessions),

    refreshTokens: many(refreshTokens),

    passwordResetTokens: many(
      passwordResetTokens,
    ),

    mfaDevices: many(mfaDevices),
  }),
);

export type Role = InferModel<typeof roles>;
export type User = InferModel<typeof users>;
export type UserProfile = InferModel<
  typeof userProfiles
>;
export type AuthSession = InferModel<
  typeof authSessions
>;
export type RefreshToken = InferModel<
  typeof refreshTokens
>;
export type PasswordResetToken = InferModel<
  typeof passwordResetTokens
>;
export type MfaDevice = InferModel<
  typeof mfaDevices
>;

export const insertRoleSchema =
  createInsertSchema(roles).omit({
    id: true,
  });

export const insertUserSchema =
  createInsertSchema(users).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  });

export const insertUserProfileSchema =
  createInsertSchema(userProfiles).omit({
    createdAt: true,
    updatedAt: true,
  });

export const insertAuthSessionSchema =
  createInsertSchema(authSessions).omit({
    id: true,
    createdAt: true,
  });

export const insertRefreshTokenSchema =
  createInsertSchema(refreshTokens).omit({
    id: true,
    issuedAt: true,
  });

export const insertPasswordResetTokenSchema =
  createInsertSchema(
    passwordResetTokens,
  ).omit({
    id: true,
  });

export const insertMfaDeviceSchema =
  createInsertSchema(mfaDevices).omit({
    id: true,
    createdAt: true,
  });
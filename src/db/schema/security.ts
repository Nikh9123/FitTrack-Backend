import { InferModel } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { apiKeyStatus } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    status: apiKeyStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    gymIndex: uniqueIndex("api_keys_gym_key_hash_idx").on(table.gymId, table.keyHash),
  }),
);

export const failedLoginAttempts = pgTable("failed_login_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id),
  ipAddress: text("ip_address"),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  success: boolean("success").notNull().default(false),
});

export const sessionCache = pgTable("session_cache", {
  sessionId: uuid("session_id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  data: jsonb("data"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantFeatureFlags = pgTable(
  "tenant_feature_flags",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    config: jsonb("config"),
  },
  (table) => ({
    featureUnique: uniqueIndex("tenant_feature_flags_gym_feature_idx").on(table.gymId, table.featureKey),
  }),
);

export type ApiKey = InferModel<typeof apiKeys>;
export type FailedLoginAttempt = InferModel<typeof failedLoginAttempts>;
export type SessionCache = InferModel<typeof sessionCache>;
export type TenantFeatureFlag = InferModel<typeof tenantFeatureFlags>;

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({ id: true, createdAt: true, revokedAt: true });
export const insertFailedLoginAttemptSchema = createInsertSchema(failedLoginAttempts).omit({ id: true, attemptedAt: true });
export const insertSessionCacheSchema = createInsertSchema(sessionCache).omit({ updatedAt: true });
export const insertTenantFeatureFlagSchema = createInsertSchema(tenantFeatureFlags).omit({ id: true });

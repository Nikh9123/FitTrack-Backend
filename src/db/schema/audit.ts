import { InferModel } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { auditAction, appEventType, errorSeverity, platformSource, paymentAuditType } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";
import { payments } from "./memberships";

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  gymId: uuid("gym_id").references(() => gyms.id),
  userId: uuid("user_id").references(() => users.id),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  action: auditAction("action").notNull(),
  changes: jsonb("changes"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const eventLogs = pgTable("event_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  gymId: uuid("gym_id").references(() => gyms.id),
  userId: uuid("user_id"),
  eventType: appEventType("event_type").notNull(),
  eventProperties: jsonb("event_properties"),
  source: platformSource("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const errorLogs = pgTable("error_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  gymId: uuid("gym_id").references(() => gyms.id),
  userId: uuid("user_id").references(() => users.id),
  service: text("service"),
  severity: errorSeverity("severity").notNull().default("medium"),
  message: text("message").notNull(),
  stackTrace: text("stack_trace"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentAuditLogs = pgTable("payment_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentId: uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  eventType: paymentAuditType("event_type").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEvent = InferModel<typeof auditEvents>;
export type EventLog = InferModel<typeof eventLogs>;
export type ErrorLog = InferModel<typeof errorLogs>;
export type PaymentAuditLog = InferModel<typeof paymentAuditLogs>;

export const insertAuditEventSchema = createInsertSchema(auditEvents).omit({ id: true, createdAt: true });
export const insertEventLogSchema = createInsertSchema(eventLogs).omit({ id: true, createdAt: true });
export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({ id: true, createdAt: true });
export const insertPaymentAuditLogSchema = createInsertSchema(paymentAuditLogs).omit({ id: true, createdAt: true });

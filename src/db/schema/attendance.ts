import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { checkinStatus, checkinType, attendanceStatus } from "./lookups";
import { gyms, gymLocations } from "./gyms";
import { memberships } from "./memberships";
import { users } from "./users";

export const gymAccessPoints = pgTable(
  "gym_access_points",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymLocationId: uuid("gym_location_id").notNull().references(() => gymLocations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("entrance"),
    qrCode: text("qr_code"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    locationIndex: index("gym_access_points_location_id_idx").on(table.gymLocationId),
  }),
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    gymLocationId: uuid("gym_location_id").notNull().references(() => gymLocations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").references(() => memberships.id),
    accessPointId: uuid("access_point_id").references(() => gymAccessPoints.id),
    eventType: checkinType("event_type").notNull(),
    status: checkinStatus("status").notNull().default("success"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    deviceMetadata: jsonb("device_metadata"),
  },
  (table) => ({
    gymIndex: index("check_ins_gym_id_idx").on(table.gymId),
    userIndex: index("check_ins_user_id_idx").on(table.userId),
    recordedAtIndex: index("check_ins_recorded_at_idx").on(table.recordedAt),
  }),
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    firstCheckInAt: timestamp("first_check_in_at", { withTimezone: true }),
    lastCheckOutAt: timestamp("last_check_out_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    attendanceStatus: attendanceStatus("attendance_status").notNull().default("present"),
  },
  (table) => ({
    uniqueDailyAttendance: uniqueIndex("attendance_records_gym_user_date_idx").on(table.gymId, table.userId, table.date),
    dateIndex: index("attendance_records_date_idx").on(table.date),
  }),
);

export const accessLogs = pgTable("access_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  accessPointId: uuid("access_point_id").references(() => gymAccessPoints.id),
  event: text("event").notNull(),
  success: boolean("success").notNull().default(true),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attendanceRelations = relations(checkIns, ({ many }) => ({
  accessLogs: many(accessLogs),
}));

export type GymAccessPoint = InferModel<typeof gymAccessPoints>;
export type CheckIn = InferModel<typeof checkIns>;
export type AttendanceRecord = InferModel<typeof attendanceRecords>;
export type AccessLog = InferModel<typeof accessLogs>;

export const insertGymAccessPointSchema = createInsertSchema(gymAccessPoints).omit({ id: true, createdAt: true });
export const insertCheckInSchema = createInsertSchema(checkIns).omit({ id: true, recordedAt: true });
export const insertAttendanceRecordSchema = createInsertSchema(attendanceRecords).omit({ id: true });
export const insertAccessLogSchema = createInsertSchema(accessLogs).omit({ id: true, createdAt: true });

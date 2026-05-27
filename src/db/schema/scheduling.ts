import { InferModel, relations } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { bookingSource, bookingStatus, sessionStatus, trainingStatus } from "./lookups";
import { gyms, gymLocations } from "./gyms";
import { users } from "./users";
import { workoutPlanTemplates } from "./workouts";

export const trainerAvailability = pgTable(
  "trainer_availability",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymLocationId: uuid("gym_location_id").notNull().references(() => gymLocations.id, { onDelete: "cascade" }),
    availableDate: timestamp("available_date", { withTimezone: true }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
    status: sessionStatus("status").notNull().default("scheduled"),
  },
  (table) => ({
    trainerDateIndex: index("trainer_availability_trainer_date_idx").on(table.trainerUserId, table.availableDate),
  }),
);

export const trainingSessions = pgTable(
  "training_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    gymLocationId: uuid("gym_location_id").notNull().references(() => gymLocations.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    memberUserId: uuid("member_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => workoutPlanTemplates.id),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }).notNull(),
    status: trainingStatus("status").notNull().default("scheduled"),
    bookingSource: bookingSource("booking_source").notNull().default("mobile"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    trainerIndex: index("training_sessions_trainer_idx").on(table.trainerUserId),
    memberIndex: index("training_sessions_member_idx").on(table.memberUserId),
    startIndex: index("training_sessions_start_idx").on(table.scheduledStart),
  }),
);

export const sessionBookings = pgTable(
  "session_bookings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trainingSessionId: uuid("training_session_id").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    bookedAt: timestamp("booked_at", { withTimezone: true }).notNull().defaultNow(),
    status: bookingStatus("status").notNull().default("confirmed"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
  },
  (table) => ({
    trainingSessionIndex: index("session_bookings_training_session_id_idx").on(table.trainingSessionId),
    userIndex: index("session_bookings_user_id_idx").on(table.userId),
  }),
);

export const classSessions = pgTable(
  "class_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").notNull().references(() => gyms.id, { onDelete: "cascade" }),
    gymLocationId: uuid("gym_location_id").notNull().references(() => gymLocations.id, { onDelete: "cascade" }),
    trainerUserId: uuid("trainer_user_id").references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    capacity: integer("capacity").notNull().default(20),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    status: sessionStatus("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymIndex: index("class_sessions_gym_id_idx").on(table.gymId),
  }),
);

export const bookingCancellations = pgTable("booking_cancellations", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookingId: uuid("booking_id").notNull().references(() => sessionBookings.id, { onDelete: "cascade" }),
  cancelledBy: uuid("cancelled_by").references(() => users.id),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
  refundAmountCents: integer("refund_amount_cents").notNull().default(0),
});

export const schedulingRelations = relations(trainingSessions, ({ many }) => ({
  bookings: many(sessionBookings),
}));

export type TrainerAvailability = InferModel<typeof trainerAvailability>;
export type TrainingSession = InferModel<typeof trainingSessions>;
export type SessionBooking = InferModel<typeof sessionBookings>;
export type ClassSession = InferModel<typeof classSessions>;
export type BookingCancellation = InferModel<typeof bookingCancellations>;

export const insertTrainerAvailabilitySchema = createInsertSchema(trainerAvailability).omit({ id: true });
export const insertTrainingSessionSchema = createInsertSchema(trainingSessions).omit({ id: true, createdAt: true });
export const insertSessionBookingSchema = createInsertSchema(sessionBookings).omit({ id: true, bookedAt: true });
export const insertClassSessionSchema = createInsertSchema(classSessions).omit({ id: true, createdAt: true });
export const insertBookingCancellationSchema = createInsertSchema(bookingCancellations).omit({ id: true, cancelledAt: true });

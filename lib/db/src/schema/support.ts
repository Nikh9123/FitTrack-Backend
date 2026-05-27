import { InferModel, relations } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { supportPriority, supportStatus } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id),
    userId: uuid("user_id").references(() => users.id),
    createdBy: uuid("created_by").references(() => users.id),
    title: text("title").notNull(),
    description: text("description"),
    priority: supportPriority("priority").notNull().default("medium"),
    status: supportStatus("status").notNull().default("open"),
    assignedTo: uuid("assigned_to").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => ({
    gymIndex: index("support_tickets_gym_id_idx").on(table.gymId),
    statusIndex: index("support_tickets_status_idx").on(table.status),
  }),
);

export const supportMessages = pgTable("support_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  ticketId: uuid("ticket_id").notNull().references(() => supportTickets.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").references(() => users.id),
  message: text("message").notNull(),
  attachments: jsonb("attachments"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportRelations = relations(supportTickets, ({ many }) => ({
  messages: many(supportMessages),
}));

export type SupportTicket = InferModel<typeof supportTickets>;
export type SupportMessage = InferModel<typeof supportMessages>;

export const insertSupportTicketSchema = createInsertSchema(supportTickets).omit({ id: true, createdAt: true, updatedAt: true, closedAt: true });
export const insertSupportMessageSchema = createInsertSchema(supportMessages).omit({ id: true, createdAt: true });

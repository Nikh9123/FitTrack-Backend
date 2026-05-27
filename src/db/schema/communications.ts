import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { chatStatus, chatThreadType, messageStatus, messageType, notificationChannel, notificationStatus, notificationType, pushPlatform } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id").references(() => gyms.id),
    type: notificationType("type").notNull(),
    channel: notificationChannel("channel").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    payload: jsonb("payload"),
    status: notificationStatus("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndex: index("notifications_user_id_idx").on(table.userId),
    statusIndex: index("notifications_status_idx").on(table.status),
  }),
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull(),
    platform: pushPlatform("platform").notNull(),
    token: text("token").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userDeviceUnique: uniqueIndex("push_subscriptions_user_device_idx").on(table.userId, table.deviceId),
  }),
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id),
    createdBy: uuid("created_by").references(() => users.id),
    threadType: chatThreadType("thread_type").notNull(),
    subject: text("subject"),
    status: chatStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    gymIndex: index("chat_threads_gym_id_idx").on(table.gymId),
    statusIndex: index("chat_threads_status_idx").on(table.status),
  }),
);

export const chatParticipants = pgTable("chat_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    messageType: messageType("message_type").notNull().default("text"),
    content: text("content"),
    attachments: jsonb("attachments"),
    status: messageStatus("status").notNull().default("sent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadIndex: index("chat_messages_thread_id_idx").on(table.threadId),
    senderIndex: index("chat_messages_sender_id_idx").on(table.senderId),
  }),
);

export const communicationsRelations = relations(chatThreads, ({ many }) => ({
  participants: many(chatParticipants),
  messages: many(chatMessages),
}));

export type Notification = InferModel<typeof notifications>;
export type PushSubscription = InferModel<typeof pushSubscriptions>;
export type ChatThread = InferModel<typeof chatThreads>;
export type ChatParticipant = InferModel<typeof chatParticipants>;
export type ChatMessage = InferModel<typeof chatMessages>;

export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true, updatedAt: true });
export const insertChatThreadSchema = createInsertSchema(chatThreads).omit({ id: true, createdAt: true, updatedAt: true });
export const insertChatParticipantSchema = createInsertSchema(chatParticipants).omit({ id: true, joinedAt: true });
export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });

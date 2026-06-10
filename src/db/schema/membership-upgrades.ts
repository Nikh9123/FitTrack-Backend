import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const membershipUpgradeRequests = pgTable(
  "membership_upgrade_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    status: text("status").notNull().default("pending"),

    transactionId: text("transaction_id"),

    proofUrl: text("proof_url"),

    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIndex: index("membership_upgrade_requests_user_idx").on(table.userId),
    statusIndex: index("membership_upgrade_requests_status_idx").on(table.status),
  }),
);

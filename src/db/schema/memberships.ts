import { InferModel, relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

import {
  invoiceStatus,
  membershipStatus,
  paymentMethodType,
  paymentStatus,
  promotionStatus,
  promotionType,
} from "./lookups";

import { gyms, gymMembershipPlans } from "./gyms";
import { users } from "./users";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    planId: uuid("plan_id").references(() => gymMembershipPlans.id),

    startDate: timestamp("start_date", {
      withTimezone: true,
    }).notNull(),

    endDate: timestamp("end_date", {
      withTimezone: true,
    }).notNull(),

    status: membershipStatus("status")
      .notNull()
      .default("active"),

    autoRenew: boolean("auto_renew")
      .notNull()
      .default(true),

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

    cancelledAt: timestamp("cancelled_at", {
      withTimezone: true,
    }),
  },
  (table) => ({
    gymUserIndex: index("memberships_gym_user_idx").on(
      table.gymId,
      table.userId,
    ),

    statusIndex: index("memberships_status_idx").on(table.status),
  }),
);

export const subscriptionInvoices = pgTable(
  "subscription_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, {
        onDelete: "cascade",
      }),

    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, {
        onDelete: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    invoiceNumber: text("invoice_number")
      .notNull()
      .unique(),

    amountCents: integer("amount_cents").notNull(),

    taxCents: integer("tax_cents").notNull(),

    currency: text("currency")
      .notNull()
      .default("INR"),

    status: invoiceStatus("status")
      .notNull()
      .default("issued"),

    issuedAt: timestamp("issued_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    dueAt: timestamp("due_at", {
      withTimezone: true,
    }),

    paidAt: timestamp("paid_at", {
      withTimezone: true,
    }),

    metadata: jsonb("metadata"),
  },
  (table) => ({
    membershipIndex: index(
      "subscription_invoices_membership_id_idx",
    ).on(table.membershipId),

    statusIndex: index(
      "subscription_invoices_status_idx",
    ).on(table.status),
  }),
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, {
        onDelete: "cascade",
      }),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    membershipId: uuid("membership_id").references(
      () => memberships.id,
    ),

    method: paymentMethodType("method").notNull(),

    processor: text("processor").notNull(),

    processorPaymentId: text("processor_payment_id").notNull(),

    amountCents: integer("amount_cents").notNull(),

    feeCents: integer("fee_cents")
      .notNull()
      .default(0),

    currency: text("currency")
      .notNull()
      .default("INR"),

    status: paymentStatus("status")
      .notNull()
      .default("pending"),

    paymentAt: timestamp("payment_at", {
      withTimezone: true,
    }),

    metadata: jsonb("metadata"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    gymIndex: index("payments_gym_id_idx").on(
      table.gymId,
    ),

    userIndex: index("payments_user_id_idx").on(
      table.userId,
    ),

    statusIndex: index("payments_status_idx").on(
      table.status,
    ),

    paymentAtIndex: index("payments_payment_at_idx").on(
      table.paymentAt,
    ),
  }),
);

export const paymentMethods = pgTable(
  "payment_methods",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    type: paymentMethodType("type").notNull(),

    provider: text("provider"),

    last4: text("last4"),

    expiryMonth: integer("expiry_month"),

    expiryYear: integer("expiry_year"),

    isDefault: boolean("is_default")
      .notNull()
      .default(false),

    isActive: boolean("is_active")
      .notNull()
      .default(true),

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
  (table) => ({
    userIndex: index("payment_methods_user_id_idx").on(
      table.userId,
    ),
  }),
);

export const promotions = pgTable(
  "promotions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, {
        onDelete: "cascade",
      }),

    code: text("code").notNull(),

    discountType: promotionType("discount_type")
      .notNull(),

    value: integer("value").notNull(),

    validFrom: timestamp("valid_from", {
      withTimezone: true,
    }).notNull(),

    validTo: timestamp("valid_to", {
      withTimezone: true,
    }).notNull(),

    maxUses: integer("max_uses"),

    usedCount: integer("used_count")
      .notNull()
      .default(0),

    status: promotionStatus("status")
      .notNull()
      .default("active"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    codeIndex: uniqueIndex(
      "promotions_gym_code_idx",
    ).on(table.gymId, table.code),
  }),
);

export const membershipsRelations = relations(
  memberships,
  ({ many }) => ({
    invoices: many(subscriptionInvoices),
    payments: many(payments),
  }),
);

export type Membership = InferModel<typeof memberships>;
export type SubscriptionInvoice = InferModel<
  typeof subscriptionInvoices
>;
export type Payment = InferModel<typeof payments>;
export type PaymentMethod = InferModel<
  typeof paymentMethods
>;
export type Promotion = InferModel<typeof promotions>;

export const insertMembershipSchema =
  createInsertSchema(memberships).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    cancelledAt: true,
  });

export const insertSubscriptionInvoiceSchema =
  createInsertSchema(subscriptionInvoices).omit({
    id: true,
    issuedAt: true,
    paidAt: true,
  });

export const insertPaymentSchema =
  createInsertSchema(payments).omit({
    id: true,
    createdAt: true,
  });

export const insertPaymentMethodSchema =
  createInsertSchema(paymentMethods).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  });

export const insertPromotionSchema =
  createInsertSchema(promotions).omit({
    id: true,
    createdAt: true,
  });
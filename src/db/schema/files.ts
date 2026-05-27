import { InferModel } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { fileEntityType, fileType } from "./lookups";
import { gyms } from "./gyms";
import { users } from "./users";

export const files = pgTable(
  "files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gymId: uuid("gym_id").references(() => gyms.id),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    fileKey: text("file_key").notNull(),
    fileType: fileType("file_type").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    storagePath: text("storage_path").notNull(),
    publicUrl: text("public_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    fileKeyIndex: uniqueIndex("files_file_key_idx").on(table.fileKey),
  }),
);

export const fileReferences = pgTable("file_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  entityType: fileEntityType("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  tag: text("tag"),
});

export type File = InferModel<typeof files>;
export type FileReference = InferModel<typeof fileReferences>;

export const insertFileSchema = createInsertSchema(files).omit({ id: true, createdAt: true });
export const insertFileReferenceSchema = createInsertSchema(fileReferences).omit({ id: true });

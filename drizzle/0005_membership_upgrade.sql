ALTER TABLE "user_profiles" ADD COLUMN IF NOT EXISTS "membership_tier" text DEFAULT 'free' NOT NULL;

CREATE TABLE IF NOT EXISTS "membership_upgrade_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" text DEFAULT 'pending' NOT NULL,
  "transaction_id" text,
  "proof_url" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "membership_upgrade_requests_user_idx" ON "membership_upgrade_requests" ("user_id");
CREATE INDEX IF NOT EXISTS "membership_upgrade_requests_status_idx" ON "membership_upgrade_requests" ("status");

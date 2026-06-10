ALTER TABLE "inbody_reports" ALTER COLUMN "report_url" DROP NOT NULL;
ALTER TABLE "inbody_reports" ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'upload' NOT NULL;

#!/usr/bin/env node

/**
 * Create the Supabase Storage bucket used for InBody report uploads.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server run setup-storage
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(scriptDir, "../../../.env") });
dotenv.config({ path: path.resolve(scriptDir, "../.env") });
dotenv.config({ path: path.resolve(scriptDir, "../../../lib/db/.env") });

const BUCKET = "inbody-reports";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL and a Supabase service/admin key in .env.");
  console.error("Create a service role key in Supabase Dashboard > Project Settings > API.");
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("SUPABASE_SERVICE_ROLE_KEY is not set. Trying SUPABASE_ANON_KEY as a fallback.");
  console.warn("If bucket creation fails, add SUPABASE_SERVICE_ROLE_KEY to your backend .env.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

try {
  console.log(`Checking Supabase Storage bucket '${BUCKET}'...`);

  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) {
    throw new Error(`Failed to list buckets: ${listError.message}`);
  }

  if (buckets?.some((bucket) => bucket.name === BUCKET)) {
    console.log(`Bucket '${BUCKET}' already exists.`);
  } else {
    const { error: createError } = await supabase.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "application/pdf",
      ],
      fileSizeLimit: 10 * 1024 * 1024,
    });

    if (createError) {
      throw new Error(`Failed to create bucket: ${createError.message}`);
    }

    console.log(`Bucket '${BUCKET}' created successfully.`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

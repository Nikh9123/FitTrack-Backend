import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const configDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = getDatabaseUrl();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const client = new Client({
  connectionString: withSupabaseSslMode(databaseUrl),
});

try {
  await client.connect();

  for (const table of ["drizzle.__drizzle_migrations", "__drizzle_migrations"]) {
    try {
      const result = await client.query(
        `SELECT id, hash, created_at FROM ${table} ORDER BY created_at`,
      );
      console.log(`Applied migrations (${table}):`);
      console.table(result.rows);
      break;
    } catch {
      // try next table name
    }
  }

  const enumResult = await client.query(`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'ai_request_type'
    ORDER BY e.enumsortorder
  `);
  console.log("ai_request_type enum values:");
  console.log(enumResult.rows.map((r) => r.enumlabel).join(", "));
} finally {
  await client.end().catch(() => undefined);
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = resolve(configDir, ".env");
  if (existsSync(envPath)) {
    const value = readDatabaseUrl(envPath);
    if (value) return value;
  }
  return undefined;
}

function readDatabaseUrl(path) {
  const contents = readFileSync(path, "utf8");
  const line = contents
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("DATABASE_URL="));
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^["']|["']$/g, "");
}

function withSupabaseSslMode(url) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

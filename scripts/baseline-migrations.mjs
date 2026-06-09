/**
 * Marks migrations 0000–0003 as already applied when the DB was created via db:push.
 * Run once before `pnpm run db:migrate` so only pending migrations (e.g. 0004) execute.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const configDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = resolve(configDir, "drizzle");
const journal = JSON.parse(
  readFileSync(resolve(drizzleDir, "meta/_journal.json"), "utf8"),
);

const BASELINE_COUNT = 4;

const databaseUrl = getDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const client = new Client({
  connectionString: withSupabaseSslMode(databaseUrl),
});

function migrationMeta(tag) {
  const content = readFileSync(resolve(drizzleDir, `${tag}.sql`), "utf8");
  const entry = journal.entries.find((e) => e.tag === tag);
  if (!entry) throw new Error(`Missing journal entry for ${tag}`);
  return {
    hash: createHash("sha256").update(content).digest("hex"),
    createdAt: entry.when,
  };
}

try {
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const existing = await client.query(
    `SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations`,
  );
  if (existing.rows[0].count > 0) {
    console.log("Migration table already has rows; skipping baseline.");
    process.exit(0);
  }

  const tags = journal.entries.slice(0, BASELINE_COUNT).map((e) => e.tag);
  for (const tag of tags) {
    const { hash, createdAt } = migrationMeta(tag);
    await client.query(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
      [hash, createdAt],
    );
    console.log(`Baselined ${tag}`);
  }

  console.log("Done. Run pnpm run db:migrate to apply pending migrations.");
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

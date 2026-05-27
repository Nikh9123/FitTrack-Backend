import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const configDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = getDatabaseUrl();

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add your Supabase Postgres URL to lib/db/.env or .env.",
  );
}

const client = new Client({
  connectionString: withSupabaseSslMode(databaseUrl),
});

try {
  await client.connect();
  const result = await client.query(`
    select
      current_database() as database,
      current_user as user_name,
      current_schema() as schema_name,
      version() as version
  `);

  console.log("Database connection OK");
  console.table(result.rows);
} finally {
  await client.end().catch(() => undefined);
}

function getDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  for (const path of [resolve(configDir, ".env"), resolve(configDir, "../../.env")]) {
    if (!existsSync(path)) {
      continue;
    }

    const value = readDatabaseUrl(path);
    if (value) {
      return value;
    }
  }

  return undefined;
}

function readDatabaseUrl(path) {
  const contents = readFileSync(path, "utf8");
  const line = contents
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("DATABASE_URL="));

  if (!line) {
    return undefined;
  }

  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^["']|["']$/g, "");
}

function withSupabaseSslMode(url) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

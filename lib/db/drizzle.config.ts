import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

const configDir = dirname(fileURLToPath(import.meta.url));
const envFiles = [resolve(configDir, ".env"), resolve(configDir, "../../.env")];
let databaseUrl = process.env.DATABASE_URL;

for (const path of envFiles) {
  if (!databaseUrl && existsSync(path)) {
    const value = readDatabaseUrl(path);
    if (value) {
      databaseUrl = value;
    }
  }
}

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add your Supabase Postgres URL to .env or lib/db/.env.",
  );
}

databaseUrl = withSupabaseSslMode(databaseUrl);

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});

function readDatabaseUrl(path: string) {
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

function withSupabaseSslMode(url: string) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

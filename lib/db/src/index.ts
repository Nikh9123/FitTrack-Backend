import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: withSupabaseSslMode(process.env.DATABASE_URL),
});
export const db = drizzle(pool, { schema });

export * from "./schema";

function withSupabaseSslMode(url: string) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) {
    return url;
  }

  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

/**
 * Seeds the food_items table from src/data/food-catalog.json
 * Run: pnpm db:seed:foods (from fitTrack-backend)
 * Idempotent — skips rows that already exist (unique index on catalog name).
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, "../src/data/food-catalog.json");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));

function withSsl(url) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

const pool = new pg.Pool({ connectionString: withSsl(process.env.DATABASE_URL) });

const INSERT_SQL = `
  INSERT INTO food_items (
    name, brand, category, serving_size_g, serving_description,
    calories_kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg,
    source, locale, is_verified
  )
  SELECT $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'fittrack_catalog', 'en_IN', true
  WHERE NOT EXISTS (
    SELECT 1 FROM food_items
    WHERE lower(name) = lower($1) AND source = 'fittrack_catalog'
  )
`;

async function main() {
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS food_items_catalog_name_uidx
      ON food_items (lower(name))
      WHERE source = 'fittrack_catalog'
  `);

  let inserted = 0;
  let skipped = 0;

  for (const item of catalog) {
    const result = await pool.query(INSERT_SQL, [
      item.name,
      item.category,
      item.servingSizeG ?? null,
      item.servingDescription,
      String(item.caloriesKcal),
      String(item.proteinG),
      String(item.carbsG),
      String(item.fatG),
      item.fiberG != null ? String(item.fiberG) : null,
      item.sodiumMg ?? null,
    ]);
    if (result.rowCount === 1) inserted++;
    else skipped++;
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM food_items WHERE source = 'fittrack_catalog'`,
  );
  console.log(`Food catalog seed complete: ${inserted} inserted, ${skipped} skipped (already present).`);
  console.log(`Total catalog items in database: ${rows[0].count}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

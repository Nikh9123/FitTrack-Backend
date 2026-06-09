/**
 * Seeds 1500+ exercises from ExerciseDB OSS API into the exercises table.
 * Run: pnpm db:seed:exercises (from fitTrack-backend)
 * Idempotent — upserts on (source, source_exercise_id).
 */
import "dotenv/config";
import pg from "pg";

const BASE = "https://oss.exercisedb.dev/api/v1";
const BATCH_SIZE = 50;
const SOURCE = "exercisedb";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

function withSsl(url) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function cleanInstruction(s) {
  return s.replace(/^Step:\d+\s*/i, "").trim();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

async function fetchPage(cursor) {
  const url = cursor
    ? `${BASE}/exercises?limit=${BATCH_SIZE}&cursor=${encodeURIComponent(cursor)}`
    : `${BASE}/exercises?limit=${BATCH_SIZE}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ExerciseDB HTTP ${res.status}`);
  return res.json();
}

const UPSERT_SQL = `
  INSERT INTO exercises (
    name, slug, body_part, target_muscle, primary_muscle, secondary_muscles,
    equipment, instructions, gif_url, source, source_exercise_id, is_public
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)
  ON CONFLICT (source, source_exercise_id)
  DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    body_part = EXCLUDED.body_part,
    target_muscle = EXCLUDED.target_muscle,
    primary_muscle = EXCLUDED.primary_muscle,
    secondary_muscles = EXCLUDED.secondary_muscles,
    equipment = EXCLUDED.equipment,
    instructions = EXCLUDED.instructions,
    gif_url = EXCLUDED.gif_url,
    updated_at = NOW()
`;

async function main() {
  const pool = new pg.Pool({ connectionString: withSsl(process.env.DATABASE_URL) });

  let cursor = null;
  let upserted = 0;
  let pages = 0;
  let catalogTotal = 1500;
  const seenIds = new Set();

  console.log("Fetching exercises from ExerciseDB OSS API…");

  while (true) {
    const payload = await fetchPage(cursor);
    if (!payload.success || !Array.isArray(payload.data)) {
      throw new Error("Invalid ExerciseDB response");
    }

    if (payload.meta?.total) catalogTotal = payload.meta.total;
    pages += 1;
    let newThisPage = 0;

    for (const raw of payload.data) {
      if (!raw.exerciseId || seenIds.has(raw.exerciseId)) continue;
      seenIds.add(raw.exerciseId);
      newThisPage += 1;

      const name = cap(raw.name ?? "Exercise");
      const bodyPart = cap(raw.bodyParts?.[0] ?? "");
      const target = cap(raw.targetMuscles?.[0] ?? "");
      const secondary = (raw.secondaryMuscles ?? []).map(cap);
      const equipment = (raw.equipments ?? []).map((e) => e.toLowerCase());
      const instructions = (raw.instructions ?? []).map(cleanInstruction).filter(Boolean).join("\n");
      const slug = `${slugify(name)}-${raw.exerciseId}`;

      await pool.query(UPSERT_SQL, [
        name,
        slug,
        bodyPart,
        target,
        target,
        secondary,
        equipment,
        instructions,
        raw.gifUrl ?? "",
        SOURCE,
        raw.exerciseId,
      ]);
      upserted += 1;
    }

    process.stdout.write(`\r  Page ${pages}: ${seenIds.size} unique / ${catalogTotal} catalog…`);

    if (seenIds.size >= catalogTotal) {
      console.log("\n  Reached catalog total — stopping.");
      break;
    }
    if (newThisPage === 0) {
      console.log("\n  No new exercises on this page — stopping.");
      break;
    }
    if (!payload.meta?.hasNextPage || !payload.meta?.nextCursor) break;
    cursor = payload.meta.nextCursor;
    await new Promise((r) => setTimeout(r, 120));
  }

  const { rows } = await pool.query(
    `SELECT count(*)::int AS count FROM exercises WHERE source = $1`,
    [SOURCE],
  );

  console.log(`\nExercise catalog seed complete: ${upserted} upserted (${seenIds.size} unique) across ${pages} pages.`);
  console.log(`Total exercisedb exercises in database: ${rows[0].count}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

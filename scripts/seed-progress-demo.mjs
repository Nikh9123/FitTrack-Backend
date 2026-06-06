/**
 * Seeds progress / fitness-journal demo data for a user.
 * Run: npm run db:seed:progress (from fitTrack-backend)
 *
 * Target user (pick one):
 *   npm run db:seed:progress -- --email=you@example.com
 *   PowerShell: $env:SEED_USER_EMAIL="you@example.com"; npm run db:seed:progress
 *
 * Env:
 *   DATABASE_URL       — required
 *   SEED_USER_EMAIL    — optional; defaults to most recently created user
 *   SEED_DAYS          — optional; default 90
 */
import "dotenv/config";
import pg from "pg";

const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
if (emailArg) process.env.SEED_USER_EMAIL = emailArg;

const SEED_DAYS = parseInt(process.env.SEED_DAYS ?? "90", 10);
const SEED_TAG = "fittrack_demo_seed";

function withSsl(url) {
  if (!url.includes("supabase.co") || url.includes("sslmode=")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}sslmode=require&uselibpqcompat=true`;
}

function dayAtNoon(daysAgo) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function resolveUser(pool) {
  const email = process.env.SEED_USER_EMAIL?.trim();
  if (email) {
    const { rows } = await pool.query(`SELECT id, email FROM users WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    if (!rows[0]) throw new Error(`No user found for SEED_USER_EMAIL=${email}`);
    return rows[0];
  }
  const { rows } = await pool.query(
    `SELECT id, email FROM users ORDER BY created_at DESC NULLS LAST LIMIT 1`,
  );
  if (!rows[0]) throw new Error("No users in database. Register in the app first, then re-run seed.");
  return rows[0];
}

async function loadFoodIds(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, calories_kcal, protein_g, carbs_g, fat_g
     FROM food_items
     WHERE source = 'fittrack_catalog'
     ORDER BY random()
     LIMIT 40`,
  );
  if (rows.length === 0) {
    throw new Error("No food catalog items. Run: pnpm db:seed:foods");
  }
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: withSsl(process.env.DATABASE_URL) });
  const user = await resolveUser(pool);
  const foods = await loadFoodIds(pool);

  console.log(`Seeding ${SEED_DAYS} days of progress data for ${user.email} (${user.id})`);

  // Remove prior demo seed so re-runs refresh data
  await pool.query(`DELETE FROM diet_logs WHERE user_id = $1 AND notes = $2`, [user.id, SEED_TAG]);
  await pool.query(
    `DELETE FROM water_logs WHERE user_id = $1 AND log_date >= now() - ($2 || ' days')::interval`,
    [user.id, String(SEED_DAYS + 1)],
  );
  await pool.query(
    `DELETE FROM activity_summaries WHERE user_id = $1 AND source_type = 'manual' AND raw_payload->>'seed' = 'true'`,
    [user.id],
  );
  await pool.query(`DELETE FROM daily_checkins WHERE user_id = $1 AND notes = $2`, [user.id, SEED_TAG]);
  await pool.query(`DELETE FROM weight_logs WHERE user_id = $1 AND notes = $2`, [user.id, SEED_TAG]);

  let activityCount = 0;
  let checkinCount = 0;
  let dietCount = 0;
  let waterCount = 0;
  let weightCount = 0;

  for (let daysAgo = SEED_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const dayIso = dayAtNoon(daysAgo);
    const wave = Math.sin(daysAgo / 4);
    const weekend = daysAgo % 7 === 0 || daysAgo % 7 === 6;

    const steps = Math.round(4200 + wave * 2200 + (weekend ? 1800 : 0) + rand(-400, 400));
    const caloriesBurned = Math.round(steps * 0.04 + rand(80, 160));
    const sleepHours = Math.round((5.4 + wave * 0.8 + rand(-0.4, 0.4)) * 10) / 10;
    const sleepMinutes = Math.round(sleepHours * 60);
    const waterMl = Math.round(1600 + wave * 400 + rand(-200, 300));
    const glasses = Math.round(waterMl / 250);

    await pool.query(
      `INSERT INTO activity_summaries
        (user_id, source_type, summary_date, steps, walking_minutes, running_minutes, sleep_minutes, calories_burned, distance_meters, raw_payload)
       VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        user.id,
        dayIso,
        steps,
        Math.round(steps / 120),
        weekend ? Math.round(rand(10, 35)) : 0,
        sleepMinutes,
        caloriesBurned,
        Math.round(steps * 0.75),
        JSON.stringify({ seed: true, tag: SEED_TAG }),
      ],
    );
    activityCount++;

    await pool.query(
      `INSERT INTO daily_checkins
        (user_id, checkin_date, energy_level, sleep_hours, soreness, recovery_score, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        user.id,
        dayIso,
        Math.min(5, Math.max(1, Math.round(2 + wave + rand(0, 2)))),
        String(sleepHours),
        Math.round(rand(1, 4)),
        Math.round(rand(2, 5)),
        SEED_TAG,
      ],
    );
    checkinCount++;

    await pool.query(
      `INSERT INTO water_logs (user_id, log_date, amount_ml)
       VALUES ($1, $2, $3)`,
      [user.id, dayIso, waterMl],
    );
    waterCount++;

    const meals = [
      { meal: "breakfast", hour: 8 },
      { meal: "lunch", hour: 13 },
      { meal: "dinner", hour: 20 },
    ];
    if (rand(0, 1) > 0.35) meals.push({ meal: "snack", hour: 16 });

    let dayCalories = 0;
    for (const { meal, hour } of meals) {
      const food = pick(foods);
      const servings = rand(0.8, 1.5);
      const kcal = Math.round(parseFloat(food.calories_kcal) * servings);
      dayCalories += kcal;
      const logAt = new Date(dayIso);
      logAt.setHours(hour, Math.round(rand(0, 45)), 0, 0);

      await pool.query(
        `INSERT INTO diet_logs
          (user_id, log_date, meal_time, food_item_id, quantity, calories_kcal, protein_g, carbs_g, fat_g, logged_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          user.id,
          dayIso,
          meal,
          food.id,
          String(Math.round(servings * 10) / 10),
          String(kcal),
          String(Math.round(parseFloat(food.protein_g ?? 0) * servings * 10) / 10),
          String(Math.round(parseFloat(food.carbs_g ?? 0) * servings * 10) / 10),
          String(Math.round(parseFloat(food.fat_g ?? 0) * servings * 10) / 10),
          logAt.toISOString(),
          SEED_TAG,
        ],
      );
      dietCount++;
    }

    // Weekly weight (every 7 days + today)
    if (daysAgo % 7 === 0) {
      const weekIndex = Math.floor(daysAgo / 7);
      const weightKg = (84.2 - weekIndex * 0.15 + rand(-0.1, 0.1)).toFixed(1);
      await pool.query(
        `INSERT INTO weight_logs (user_id, recorded_at, weight_kg, notes)
         VALUES ($1, $2, $3, $4)`,
        [user.id, dayIso, weightKg, SEED_TAG],
      );
      weightCount++;
    }
  }

  const { rows: summary } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM activity_summaries WHERE user_id = $1 AND raw_payload->>'seed' = 'true') AS activity,
       (SELECT count(*)::int FROM daily_checkins WHERE user_id = $1 AND notes = $2) AS checkins,
       (SELECT count(*)::int FROM diet_logs WHERE user_id = $1 AND notes = $2) AS meals,
       (SELECT count(*)::int FROM water_logs WHERE user_id = $1 AND log_date >= now() - ($3 || ' days')::interval) AS water,
       (SELECT count(*)::int FROM weight_logs WHERE user_id = $1 AND notes = $2) AS weights`,
    [user.id, SEED_TAG, String(SEED_DAYS + 1)],
  );

  console.log("\nDemo progress seed complete:");
  console.log(`  Activity days:  ${activityCount} (total seed rows: ${summary[0].activity})`);
  console.log(`  Check-ins:      ${checkinCount}`);
  console.log(`  Meal logs:      ${dietCount}`);
  console.log(`  Water logs:     ${waterCount}`);
  console.log(`  Weight logs:    ${weightCount}`);
  console.log("\nReload the Progress tab in the app to see charts and insights.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

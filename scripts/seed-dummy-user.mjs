/**
 * Creates a fully populated dummy test user for FitTrack.
 *
 * Run:  npm run db:seed:dummy
 *       npm run db:seed:foods   (first, if food catalog empty)
 *
 * Login credentials (default):
 *   Email:    dummyuser@gmail.com
 *   Password: 12345678
 *
 * Override email:  npm run db:seed:dummy -- --email=you@example.com
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

const emailArg = process.argv.find((a) => a.startsWith("--email="))?.slice("--email=".length);
const DUMMY_EMAIL = (emailArg ?? process.env.DUMMY_USER_EMAIL ?? "dummyuser@gmail.com").trim().toLowerCase();
const DUMMY_PASSWORD = process.env.DUMMY_USER_PASSWORD ?? "12345678";
const DUMMY_USERNAME = "dummyuser";
const SEED_TAG = "fittrack_dummy_user";
const SEED_DAYS = parseInt(process.env.SEED_DAYS ?? "90", 10);

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

async function ensureGym(pool) {
  const slug = "fittrack-app";
  let { rows } = await pool.query(`SELECT id FROM gyms WHERE slug = $1 LIMIT 1`, [slug]);
  if (rows[0]) return rows[0].id;
  ({ rows } = await pool.query(
    `INSERT INTO gyms (name, slug, status, timezone, currency)
     VALUES ('FitTrack', $1, 'active', 'Asia/Kolkata', 'INR')
     RETURNING id`,
    [slug],
  ));
  return rows[0].id;
}

async function loadFoodIds(pool) {
  const { rows } = await pool.query(
    `SELECT id, name, calories_kcal, protein_g, carbs_g, fat_g
     FROM food_items WHERE source = 'fittrack_catalog'
     ORDER BY random() LIMIT 40`,
  );
  if (rows.length === 0) {
    throw new Error("No food catalog. Run: npm run db:seed:foods");
  }
  return rows;
}

async function ensureExercises(pool) {
  const { rows } = await pool.query(`SELECT id, name FROM exercises ORDER BY name LIMIT 8`);
  if (rows.length >= 3) return rows;

  const basics = [
    { name: "Push Up", slug: "dummy-push-up", body: "chest", muscle: "chest" },
    { name: "Squat", slug: "dummy-squat", body: "legs", muscle: "quadriceps" },
    { name: "Plank", slug: "dummy-plank", body: "core", muscle: "abs" },
    { name: "Lunges", slug: "dummy-lunges", body: "legs", muscle: "glutes" },
  ];
  for (const ex of basics) {
    await pool.query(
      `INSERT INTO exercises (name, slug, body_part, primary_muscle, is_public, source)
       SELECT $1, $2, $3, $4, true, 'dummy_seed'
       WHERE NOT EXISTS (SELECT 1 FROM exercises WHERE slug = $2)`,
      [ex.name, ex.slug, ex.body, ex.muscle],
    );
  }
  const { rows: fresh } = await pool.query(`SELECT id, name FROM exercises ORDER BY name LIMIT 8`);
  return fresh;
}

async function ensureAchievements(pool) {
  const defs = [
    { name: "First Workout", description: "Complete your first workout", type: "workout", points: 10 },
    { name: "7-Day Streak", description: "Work out 7 days in a row", type: "workout", points: 25 },
    { name: "Hydration Hero", description: "Log water 7 days straight", type: "hydration", points: 15 },
    { name: "Check-in Champ", description: "Log 5 daily check-ins", type: "checkin", points: 20 },
  ];
  const ids = [];
  for (const d of defs) {
    let { rows } = await pool.query(
      `SELECT id FROM achievement_definitions WHERE name = $1 LIMIT 1`,
      [d.name],
    );
    if (!rows[0]) {
      ({ rows } = await pool.query(
        `INSERT INTO achievement_definitions (name, description, type, criteria, points, is_active)
         VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [d.name, d.description, d.type, JSON.stringify({ seed: true }), d.points],
      ));
    }
    ids.push(rows[0].id);
  }
  return ids;
}

async function createUser(pool, passwordHash) {
  await pool.query(`DELETE FROM users WHERE lower(email) = lower($1)`, [DUMMY_EMAIL]);

  const { rows } = await pool.query(
    `INSERT INTO users (email, username, password_hash, primary_role, status, is_email_verified, locale, timezone)
     VALUES ($1, $2, $3, 'member', 'active', true, 'en_IN', 'Asia/Kolkata')
     RETURNING id, email`,
    [DUMMY_EMAIL, DUMMY_USERNAME, passwordHash],
  );
  const userId = rows[0].id;

  await pool.query(
    `INSERT INTO user_profiles (
       user_id, first_name, last_name, gender, date_of_birth, auth_provider,
       onboarding_completed, height_cm, weight_kg, bmi, body_fat_percent,
       fitness_goal, activity_level, dietary_preference, workout_experience, region,
       onboarding_data, bio
     ) VALUES (
       $1, 'Demo', 'User', 'male', '1995-06-15', 'email',
       true, '175', '109', '35.6', '30.2',
       'weight_loss', 'moderate', 'vegetarian', 'intermediate', 'south',
       $2, 'Dummy account for testing all FitTrack features.'
     )`,
    [
      userId,
      JSON.stringify({
        goal: "weight_loss",
        region: "south",
        dietaryPreference: "vegetarian",
        completedAt: new Date().toISOString(),
      }),
    ],
  );

  return userId;
}

async function seedProgress(pool, userId, foods) {
  for (let daysAgo = SEED_DAYS - 1; daysAgo >= 0; daysAgo--) {
    const dayIso = dayAtNoon(daysAgo);
    const wave = Math.sin(daysAgo / 4);
    const weekend = daysAgo % 7 === 0 || daysAgo % 7 === 6;

    const steps = Math.round(5500 + wave * 2500 + (weekend ? 1500 : 0) + rand(-300, 300));
    const caloriesBurned = Math.round(steps * 0.04 + rand(90, 180));
    const sleepHours = Math.round((6.2 + wave * 0.9 + rand(-0.3, 0.3)) * 10) / 10;
    const waterMl = Math.round(1800 + wave * 350 + rand(-150, 250));

    await pool.query(
      `INSERT INTO activity_summaries
         (user_id, source_type, summary_date, steps, walking_minutes, running_minutes,
          sleep_minutes, calories_burned, distance_meters, raw_payload)
       VALUES ($1, 'manual', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        dayIso,
        steps,
        Math.round(steps / 110),
        weekend ? Math.round(rand(15, 40)) : 0,
        Math.round(sleepHours * 60),
        caloriesBurned,
        Math.round(steps * 0.78),
        JSON.stringify({ seed: true, tag: SEED_TAG }),
      ],
    );

    await pool.query(
      `INSERT INTO daily_checkins
         (user_id, checkin_date, energy_level, sleep_hours, soreness, recovery_score, mood, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        userId,
        dayIso,
        Math.min(5, Math.max(2, Math.round(3 + wave + rand(-1, 1)))),
        String(sleepHours),
        Math.round(rand(1, 3)),
        Math.round(rand(3, 5)),
        Math.round(rand(3, 5)),
        SEED_TAG,
      ],
    );

    await pool.query(
      `INSERT INTO water_logs (user_id, log_date, amount_ml) VALUES ($1, $2, $3)`,
      [userId, dayIso, waterMl],
    );

    // Weekly scale weight logs (weight_logs table) — trend 112.4 → ~109 kg
    if (daysAgo % 7 === 0) {
      const weekIndex = Math.floor(daysAgo / 7);
      const weightKg = (112.4 - weekIndex * 0.12 + rand(-0.15, 0.15)).toFixed(1);
      await pool.query(
        `INSERT INTO weight_logs (user_id, recorded_at, weight_kg, notes)
         VALUES ($1, $2, $3, $4)`,
        [userId, dayIso, weightKg, SEED_TAG],
      );
    }

    for (const { meal, hour } of [
      { meal: "breakfast", hour: 8 },
      { meal: "lunch", hour: 13 },
      { meal: "dinner", hour: 20 },
      ...(rand(0, 1) > 0.4 ? [{ meal: "snack", hour: 16 }] : []),
    ]) {
      const food = pick(foods);
      const servings = rand(0.9, 1.4);
      const kcal = Math.round(parseFloat(food.calories_kcal) * servings);
      const logAt = new Date(dayIso);
      logAt.setHours(hour, Math.round(rand(0, 40)), 0, 0);
      await pool.query(
        `INSERT INTO diet_logs
           (user_id, log_date, meal_time, food_item_id, quantity,
            calories_kcal, protein_g, carbs_g, fat_g, logged_at, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          userId,
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
    }
  }
}

async function seedInbodyReports(pool, userId) {
  const scans = [
    {
      daysAgo: 75,
      metrics: {
        weight: "112.4",
        bmi: "36.7",
        bodyFat: "32.8",
        skeletalMuscleMass: "37.2",
        bmr: "1980",
        visceralFat: "14",
        bodyWater: "42.1",
      },
      score: 58,
    },
    {
      daysAgo: 14,
      metrics: {
        weight: "109.0",
        bmi: "35.6",
        bodyFat: "30.2",
        skeletalMuscleMass: "38.5",
        bmr: "2010",
        visceralFat: "12",
        bodyWater: "43.0",
      },
      score: 72,
    },
  ];

  for (const scan of scans) {
    const createdAt = dayAtNoon(scan.daysAgo);
    await pool.query(
      `INSERT INTO inbody_reports
         (user_id, report_url, file_type, file_name, extracted_text, extracted_metrics,
          status, gemini_analysis, created_at, updated_at)
       VALUES ($1, $2, 'image/jpeg', $3, $4, $5, 'done', $6, $7, $7)`,
      [
        userId,
        `https://placeholder.fittrack.local/inbody/${SEED_TAG}-${scan.daysAgo}.jpg`,
        `dummy-inbody-${scan.daysAgo}.jpg`,
        `Dummy InBody scan ${scan.daysAgo}d ago`,
        JSON.stringify(scan.metrics),
        JSON.stringify({
          inbodyScore: String(scan.score),
          overallSummary: "Dummy InBody analysis for testing.",
          fitnessLevel: scan.score >= 70 ? "Good" : "Fair",
          strengths: ["Consistent logging", "Improving muscle mass"],
          recommendations: ["Keep protein high", "Walk 8k+ steps daily"],
        }),
        createdAt,
      ],
    );
  }
}

async function seedWorkouts(pool, userId, exercises) {
  const { rows: planRows } = await pool.query(
    `INSERT INTO user_workout_plans (user_id, title, category, goal, estimated_calories, estimated_duration, ai_generated)
     VALUES ($1, 'Full Body Starter', 'strength', 'weight_loss', 320, '45 min', true)
     RETURNING id`,
    [userId],
  );
  const planId = planRows[0].id;

  const dayName = "Day 1 — Push & Legs";
  for (let i = 0; i < Math.min(4, exercises.length); i++) {
    const ex = exercises[i];
    await pool.query(
      `INSERT INTO user_workout_exercises
         (workout_plan_id, exercise_id, exercise_name, day_name, sets, reps, calories, muscle_group, order_index)
       VALUES ($1, $2, $3, $4, 3, '12', 80, $5, $6)`,
      [planId, ex.id, ex.name, dayName, ex.name.includes("Push") ? "chest" : "legs", i],
    );
  }

  for (let w = 0; w < 8; w++) {
    const started = dayAtNoon(w * 3 + 1);
    const completed = new Date(started);
    completed.setMinutes(completed.getMinutes() + 42);
    const { rows: sess } = await pool.query(
      `INSERT INTO user_workout_sessions
         (user_id, workout_plan_id, started_at, completed_at, total_duration, calories_burned, completion_percentage)
       VALUES ($1, $2, $3, $4, 2520, $5, 100)
       RETURNING id`,
      [userId, planId, started, completed.toISOString(), Math.round(rand(280, 380))],
    );
    const sessionId = sess[0].id;
    const ex = exercises[w % exercises.length];
    await pool.query(
      `INSERT INTO exercise_logs (workout_session_id, exercise_id, weight, reps, sets_completed, notes)
       VALUES ($1, $2, $3, 12, 3, $4)`,
      [sessionId, ex.id, String(20 + w * 2.5), SEED_TAG],
    );
  }

  const ex0 = exercises[0];
  await pool.query(
    `INSERT INTO personal_records (user_id, exercise_id, max_weight, max_reps)
     VALUES ($1, $2, '40', 15)`,
    [userId, ex0.id],
  );

  await pool.query(
    `INSERT INTO activity_insights (user_id, weekly_calories, monthly_calories, streak_days, workouts_completed, total_volume_lifted)
     VALUES ($1, 1850, 7200, 12, 8, '12450')`,
    [userId],
  );
}

async function seedDietPlan(pool, userId, gymId, foods) {
  const meta = JSON.stringify({
    source: "ai",
    summary: "South-Indian vegetarian plan tuned for weight loss at ~109 kg.",
    tips: ["Drink 2.5L water daily", "Walk after dinner", "Protein at every meal"],
    duration: "daily",
    region: "south",
    personalization: {
      usedInbody: true,
      usedWeightLogs: true,
      usedNutritionLogs: true,
      usedActivity: true,
      currentWeightKg: 109,
      bodyFatPercent: "30.2",
    },
  });

  const { rows: planRows } = await pool.query(
    `INSERT INTO diet_plans (gym_id, user_id, title, goal, status, start_date, notes)
     VALUES ($1, $2, 'South Indian Weight Loss Plan', 'weight_loss', 'active', now(), $3)
     RETURNING id`,
    [gymId, userId, meta],
  );
  const planId = planRows[0].id;

  const meals = [
    { time: "breakfast", name: "Idli & Sambar", idx: 0 },
    { time: "lunch", name: "Dal Rice Bowl", idx: 1 },
    { time: "snack", name: "Fruit & Nuts", idx: 2 },
    { time: "dinner", name: "Roti & Sabzi", idx: 3 },
  ];

  for (const meal of meals) {
    const food = foods[meal.idx % foods.length];
    const { rows: mealRows } = await pool.query(
      `INSERT INTO diet_plan_meals (diet_plan_id, meal_time, name, order_index)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [planId, meal.time, meal.name, meal.idx],
    );
    await pool.query(
      `INSERT INTO diet_plan_items (meal_id, food_item_id, quantity)
       VALUES ($1, $2, '1')`,
      [mealRows[0].id, food.id],
    );
  }

  await pool.query(
    `INSERT INTO nutrition_targets (user_id, gym_id, start_date, daily_calories, protein_g, carbs_g, fat_g)
     VALUES ($1, $2, now(), 2100, '130', '220', '65')`,
    [userId, gymId],
  );
}

async function seedStreaksAndAchievements(pool, userId, gymId, achievementIds) {
  await pool.query(
    `INSERT INTO user_streaks (user_id, gym_id, type, current_streak, longest_streak, last_active_at)
     VALUES ($1, $2, 'workout', 12, 18, now())`,
    [userId, gymId],
  );

  for (let i = 0; i < Math.min(3, achievementIds.length); i++) {
    await pool.query(
      `INSERT INTO user_achievements (user_id, gym_id, achievement_id, earned_at)
       VALUES ($1, $2, $3, now() - ($4 || ' days')::interval)`,
      [userId, gymId, achievementIds[i], String(i * 5 + 2)],
    );
  }

  await pool.query(
    `INSERT INTO goals (user_id, gym_id, goal_type, target_value, unit, start_date, status)
     VALUES ($1, $2, 'weight', '100', 'kg', now() - interval '30 days', 'active')`,
    [userId, gymId],
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: withSsl(process.env.DATABASE_URL) });
  const passwordHash = await bcrypt.hash(DUMMY_PASSWORD, 12);

  console.log(`\n🌱 Seeding dummy user: ${DUMMY_EMAIL}`);
  console.log(`   Password: ${DUMMY_PASSWORD}\n`);

  const gymId = await ensureGym(pool);
  const foods = await loadFoodIds(pool);
  const exercises = await ensureExercises(pool);
  const achievementIds = await ensureAchievements(pool);

  const userId = await createUser(pool, passwordHash);

  await seedProgress(pool, userId, foods);
  await seedInbodyReports(pool, userId);
  await seedWorkouts(pool, userId, exercises);
  await seedDietPlan(pool, userId, gymId, foods);
  await seedStreaksAndAchievements(pool, userId, gymId, achievementIds);

  const { rows: counts } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM activity_summaries WHERE user_id = $1) AS activity_days,
       (SELECT count(*)::int FROM diet_logs WHERE user_id = $1) AS meal_logs,
       (SELECT count(*)::int FROM daily_checkins WHERE user_id = $1) AS checkins,
       (SELECT count(*)::int FROM inbody_reports WHERE user_id = $1) AS inbody_scans,
       (SELECT count(*)::int FROM weight_logs WHERE user_id = $1) AS weight_logs,
       (SELECT count(*)::int FROM user_workout_sessions WHERE user_id = $1) AS workouts,
       (SELECT count(*)::int FROM diet_plans WHERE user_id = $1) AS diet_plans,
       (SELECT count(*)::int FROM user_achievements WHERE user_id = $1) AS achievements`,
    [userId],
  );

  const c = counts[0];
  console.log("✅ Dummy user ready!\n");
  console.log("Login:");
  console.log(`  Email:    ${DUMMY_EMAIL}`);
  console.log(`  Password: ${DUMMY_PASSWORD}`);
  console.log("\nSeeded data:");
  console.log(`  Activity days:  ${c.activity_days}`);
  console.log(`  Meal logs:      ${c.meal_logs}`);
  console.log(`  Check-ins:      ${c.checkins}`);
  console.log(`  InBody scans:   ${c.inbody_scans} (109 kg latest)`);
  console.log(`  Weight logs:    ${c.weight_logs} (scale / weight_logs)`);
  console.log(`  Workout sess.:  ${c.workouts}`);
  console.log(`  Diet plans:     ${c.diet_plans}`);
  console.log(`  Achievements:   ${c.achievements}`);
  console.log("\nOpen the app → log in with the credentials above.\n");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

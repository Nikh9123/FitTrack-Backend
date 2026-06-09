/**
 * Seed the full Veera achievement catalog.
 * Criteria schema documented in src/services/achievementService.ts
 *
 * Usage: node ./scripts/seed-achievements.mjs
 */
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

const ACHIEVEMENTS = [
  // ── Workout ──
  {
    name: "First Workout",
    description: "Complete your first workout session",
    type: "workout",
    points: 10,
    criteria: { metric: "workout_count", threshold: 1, category: "workout", rarity: "common" },
  },
  {
    name: "Getting Started",
    description: "Complete 10 workouts",
    type: "workout",
    points: 25,
    criteria: { metric: "workout_count", threshold: 10, category: "workout", rarity: "common" },
  },
  {
    name: "Dedicated Trainer",
    description: "Complete 50 workouts",
    type: "workout",
    points: 75,
    criteria: {
      metric: "workout_count",
      threshold: 50,
      category: "workout",
      rarity: "rare",
      titleUnlock: "Strength Builder",
    },
  },
  {
    name: "Workout Centurion",
    description: "Complete 100 workouts",
    type: "workout",
    points: 150,
    criteria: {
      metric: "workout_count",
      threshold: 100,
      category: "workout",
      rarity: "epic",
      titleUnlock: "Iron Warrior",
    },
  },
  {
    name: "Fitness Legend",
    description: "Complete 500 workouts",
    type: "workout",
    points: 500,
    criteria: {
      metric: "workout_count",
      threshold: 500,
      category: "workout",
      rarity: "mythic",
      titleUnlock: "Fitness Legend",
    },
  },

  // ── Steps ──
  {
    name: "10K Steps Day",
    description: "Walk 10,000 steps in a single day",
    type: "workout",
    points: 15,
    criteria: { metric: "step_single_day", threshold: 10000, category: "steps", rarity: "common" },
  },
  {
    name: "Step Explorer",
    description: "Walk 50,000 total steps",
    type: "workout",
    points: 20,
    criteria: { metric: "step_total", threshold: 50000, category: "steps", rarity: "common" },
  },
  {
    name: "Road Warrior",
    description: "Walk 100,000 total steps",
    type: "workout",
    points: 50,
    criteria: { metric: "step_total", threshold: 100000, category: "steps", rarity: "rare" },
  },
  {
    name: "Marathon Master",
    description: "Walk 500,000 total steps",
    type: "workout",
    points: 150,
    criteria: { metric: "step_total", threshold: 500000, category: "steps", rarity: "epic" },
  },
  {
    name: "Million Miler",
    description: "Walk 1,000,000 total steps",
    type: "workout",
    points: 500,
    criteria: { metric: "step_total", threshold: 1000000, category: "steps", rarity: "mythic" },
  },

  // ── Weight loss ──
  {
    name: "First 1 kg",
    description: "Lose your first kilogram",
    type: "checkin",
    points: 20,
    criteria: { metric: "weight_lost_kg", threshold: 1, category: "weight", rarity: "common" },
  },
  {
    name: "Momentum",
    description: "Lose 5 kg from your starting weight",
    type: "checkin",
    points: 75,
    criteria: {
      metric: "weight_lost_kg",
      threshold: 5,
      category: "weight",
      rarity: "rare",
      titleUnlock: "Calorie Crusher",
    },
  },
  {
    name: "Transformation",
    description: "Lose 10 kg from your starting weight",
    type: "checkin",
    points: 150,
    criteria: { metric: "weight_lost_kg", threshold: 10, category: "weight", rarity: "epic" },
  },
  {
    name: "New You",
    description: "Lose 20 kg from your starting weight",
    type: "checkin",
    points: 300,
    criteria: {
      metric: "weight_lost_kg",
      threshold: 20,
      category: "weight",
      rarity: "legendary",
      titleUnlock: "Master of Willpower",
    },
  },
  {
    name: "Transformation Complete",
    description: "Lose 30 kg from your starting weight",
    type: "checkin",
    points: 500,
    criteria: { metric: "weight_lost_kg", threshold: 30, category: "weight", rarity: "mythic" },
  },

  // ── Streaks ──
  {
    name: "Week Warrior",
    description: "Maintain a 7-day workout streak",
    type: "workout",
    points: 30,
    criteria: { metric: "streak_days", threshold: 7, category: "streak", rarity: "common" },
  },
  {
    name: "Month Master",
    description: "Maintain a 30-day workout streak",
    type: "workout",
    points: 100,
    criteria: {
      metric: "streak_days",
      threshold: 30,
      category: "streak",
      rarity: "rare",
      titleUnlock: "Consistency King",
    },
  },
  {
    name: "Two Month Titan",
    description: "Maintain a 60-day workout streak",
    type: "workout",
    points: 200,
    criteria: { metric: "streak_days", threshold: 60, category: "streak", rarity: "epic" },
  },
  {
    name: "Century Club",
    description: "Maintain a 100-day workout streak",
    type: "workout",
    points: 350,
    criteria: { metric: "streak_days", threshold: 100, category: "streak", rarity: "legendary" },
  },
  {
    name: "Year of Iron",
    description: "Maintain a 365-day workout streak",
    type: "workout",
    points: 1000,
    criteria: { metric: "streak_days", threshold: 365, category: "streak", rarity: "mythic" },
  },

  // ── Hydration ──
  {
    name: "Hydration Hero",
    description: "Meet your water goal on 7 days",
    type: "hydration",
    points: 25,
    criteria: {
      metric: "hydration_days",
      threshold: 7,
      window: "rolling_30d",
      category: "hydration",
      rarity: "common",
      titleUnlock: "Hydration Hero",
    },
  },
  {
    name: "Hydration Champion",
    description: "Meet your water goal on 30 days",
    type: "hydration",
    points: 100,
    criteria: { metric: "hydration_days", threshold: 30, window: "rolling_30d", category: "hydration", rarity: "rare" },
  },
  {
    name: "Water Master",
    description: "Meet your water goal on 100 days",
    type: "hydration",
    points: 250,
    criteria: { metric: "hydration_days", threshold: 100, window: "lifetime", category: "hydration", rarity: "epic" },
  },

  // ── Sleep ──
  {
    name: "Well Rested",
    description: "Log 7 nights with 7+ hours of sleep",
    type: "checkin",
    points: 25,
    criteria: {
      metric: "sleep_nights",
      threshold: 7,
      window: "rolling_30d",
      category: "sleep",
      rarity: "common",
      minSleepHours: 7,
      titleUnlock: "Sleep Champion",
    },
  },
  {
    name: "Sleep Consistency",
    description: "Log 30 nights with 7+ hours of sleep",
    type: "checkin",
    points: 100,
    criteria: {
      metric: "sleep_nights",
      threshold: 30,
      window: "rolling_30d",
      category: "sleep",
      rarity: "rare",
      minSleepHours: 7,
    },
  },
  {
    name: "Recovery Pro",
    description: "Log 100 nights with 7+ hours of sleep",
    type: "checkin",
    points: 250,
    criteria: {
      metric: "sleep_nights",
      threshold: 100,
      window: "lifetime",
      category: "sleep",
      rarity: "epic",
      minSleepHours: 7,
    },
  },

  // ── Check-ins ──
  {
    name: "Check-in Champ",
    description: "Log 5 daily check-ins",
    type: "checkin",
    points: 20,
    criteria: { metric: "checkin_count", threshold: 5, category: "checkin", rarity: "common" },
  },
  {
    name: "Self Aware",
    description: "Log 30 daily check-ins",
    type: "checkin",
    points: 75,
    criteria: { metric: "checkin_count", threshold: 30, category: "checkin", rarity: "rare" },
  },
  {
    name: "Mindful Athlete",
    description: "Log 100 daily check-ins",
    type: "checkin",
    points: 200,
    criteria: { metric: "checkin_count", threshold: 100, category: "checkin", rarity: "epic" },
  },

  // ── Strength / PRs ──
  {
    name: "First PR",
    description: "Set your first personal record",
    type: "workout",
    points: 25,
    criteria: { metric: "pr_count", threshold: 1, category: "strength", rarity: "common" },
  },
  {
    name: "PR Machine",
    description: "Set 10 personal records",
    type: "workout",
    points: 100,
    criteria: { metric: "pr_count", threshold: 10, category: "strength", rarity: "rare" },
  },
  {
    name: "Strength Specialist",
    description: "Set 50 personal records",
    type: "workout",
    points: 250,
    criteria: {
      metric: "pr_count",
      threshold: 50,
      category: "strength",
      rarity: "epic",
      titleUnlock: "Strength Builder",
    },
  },
  {
    name: "PR Legend",
    description: "Set 100 personal records",
    type: "workout",
    points: 500,
    criteria: { metric: "pr_count", threshold: 100, category: "strength", rarity: "legendary" },
  },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = 0;
  let updated = 0;

  try {
    for (const ach of ACHIEVEMENTS) {
      const { rows } = await pool.query(
        `SELECT id, criteria FROM achievement_definitions WHERE name = $1 LIMIT 1`,
        [ach.name],
      );

      if (rows[0]) {
        await pool.query(
          `UPDATE achievement_definitions
           SET description = $2, type = $3, criteria = $4, points = $5, is_active = true
           WHERE id = $1`,
          [rows[0].id, ach.description, ach.type, JSON.stringify(ach.criteria), ach.points],
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO achievement_definitions (name, description, type, criteria, points, is_active)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [ach.name, ach.description, ach.type, JSON.stringify(ach.criteria), ach.points],
        );
        inserted++;
      }
    }

    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total FROM achievement_definitions WHERE is_active = true`,
    );
    console.log(`Achievements seeded: ${inserted} inserted, ${updated} updated`);
    console.log(`Active definitions in catalog: ${countRows[0].total}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

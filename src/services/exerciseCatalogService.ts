import { db, exercises } from "../db";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import type { ExerciseDBExercise } from "../lib/exercisedb";
import { fetchExercisesByBodyPart } from "../lib/exercisedb";
import { logger } from "../lib/logger";

const BODY_PART_MAP: Record<string, string> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  "upper arms": "upper arms",
  "lower arms": "lower arms",
  "upper legs": "upper legs",
  "lower legs": "lower legs",
  waist: "waist",
  cardio: "cardio",
  neck: "neck",
};

const PREFERRED_EQUIPMENT = new Set([
  "barbell",
  "dumbbell",
  "cable",
  "body weight",
  "machine",
  "smith machine",
  "leverage machine",
  "kettlebell",
  "band",
  "resistance band",
]);

const COMPOUND_HINTS = [
  "bench press",
  "squat",
  "deadlift",
  "row",
  "press",
  "pull-up",
  "pull up",
  "lat pulldown",
  "leg press",
  "curl",
  "extension",
  "fly",
  "raise",
  "lunge",
  "hip thrust",
  "calf raise",
];

const LOW_QUALITY_HINTS = ["impossible", "kick", "variation", "style", "classic", "male)", "female)"];

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function scoreExerciseName(name: string, equipment: string | null): number {
  const lower = name.toLowerCase();
  let score = 0;
  for (const hint of COMPOUND_HINTS) {
    if (lower.includes(hint)) score += 3;
  }
  const eq = (equipment ?? "").toLowerCase();
  if (PREFERRED_EQUIPMENT.has(eq)) score += 2;
  if (eq === "barbell" || eq === "dumbbell") score += 1;
  for (const bad of LOW_QUALITY_HINTS) {
    if (lower.includes(bad)) score -= 4;
  }
  if (lower.split(" ").length <= 4) score += 1;
  return score;
}

function mapRowToExerciseDB(row: typeof exercises.$inferSelect): ExerciseDBExercise {
  const equipment = row.equipment?.[0] ?? "body weight";
  const instructions = row.instructions
    ? row.instructions.split("\n").map((s) => s.trim()).filter(Boolean)
    : [];
  return {
    id: row.sourceExerciseId ?? row.id,
    name: row.name,
    bodyPart: row.bodyPart ?? "",
    target: row.targetMuscle ?? row.primaryMuscle ?? "",
    secondaryMuscles: row.secondaryMuscles ?? [],
    equipment: cap(equipment),
    gifUrl: row.gifUrl ?? "",
    instructions,
  };
}

export async function getCatalogCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(exercises)
    .where(eq(exercises.source, "exercisedb"));
  return row?.count ?? 0;
}

export async function searchExercisesFromCatalog(opts: {
  query?: string;
  bodyPart?: string;
  equipment?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(opts.limit ?? 30, 100);
  const offset = opts.offset ?? 0;
  const conditions = [eq(exercises.source, "exercisedb"), eq(exercises.isPublic, true)];

  if (opts.bodyPart?.trim()) {
    conditions.push(ilike(exercises.bodyPart, opts.bodyPart.trim()));
  }
  if (opts.equipment?.trim()) {
    conditions.push(sql`${exercises.equipment} @> ARRAY[${opts.equipment.trim().toLowerCase()}]::text[]`);
  }
  if (opts.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    conditions.push(or(ilike(exercises.name, q), ilike(exercises.bodyPart, q), ilike(exercises.targetMuscle, q))!);
  }

  const rows = await db
    .select()
    .from(exercises)
    .where(and(...conditions))
    .orderBy(exercises.name)
    .limit(limit)
    .offset(offset);

  return rows.map(mapRowToExerciseDB);
}

/**
 * Pick quality-scored exercises for plan generation from the local catalog.
 */
export async function pickExercisesForBodyPart(
  bodyPart: string,
  limit = 6,
): Promise<ExerciseDBExercise[]> {
  const mapped = BODY_PART_MAP[bodyPart.toLowerCase().trim()] ?? bodyPart.toLowerCase().trim();

  const rows = await db
    .select()
    .from(exercises)
    .where(
      and(
        eq(exercises.source, "exercisedb"),
        eq(exercises.isPublic, true),
        ilike(exercises.bodyPart, mapped),
      ),
    )
    .limit(Math.max(limit * 8, 40));

  if (rows.length === 0) {
    logger.warn({ bodyPart: mapped }, "No catalog exercises — falling back to ExerciseDB API");
    return fetchExercisesByBodyPart(bodyPart, limit);
  }

  const ranked = rows
    .map((row) => ({
      row,
      score: scoreExerciseName(row.name, row.equipment?.[0] ?? null),
    }))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const picked: ExerciseDBExercise[] = [];
  for (const { row } of ranked) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(mapRowToExerciseDB(row));
    if (picked.length >= limit) break;
  }

  return picked.length > 0 ? picked : fetchExercisesByBodyPart(bodyPart, limit);
}

const CATEGORY_BODY_PARTS: Record<string, string[]> = {
  strength: ["chest", "back", "shoulders", "upper legs", "upper arms"],
  hiit: ["cardio"],
  focus: ["chest", "back", "shoulders"],
  agility: ["cardio", "upper legs"],
  mobility: ["waist", "lower legs"],
};

export async function getExercisesByCategory(category: string, limit = 12) {
  const parts = CATEGORY_BODY_PARTS[category.toLowerCase()] ?? CATEGORY_BODY_PARTS.strength;
  const exclude = new Set<string>();
  const results: ExerciseDBExercise[] = [];
  const perPart = Math.ceil(limit / parts.length);
  for (const part of parts) {
    const picked = await pickExercisesForBodyPart(part, perPart);
    for (const ex of picked) {
      const key = ex.name.toLowerCase();
      if (exclude.has(key)) continue;
      exclude.add(key);
      results.push(ex);
    }
  }
  return results.slice(0, limit);
}

export async function resolveExercisesForBodyPart(
  bodyPart: string,
  limit: number,
): Promise<ExerciseDBExercise[]> {
  const count = await getCatalogCount();
  if (count >= 100) {
    return pickExercisesForBodyPart(bodyPart, limit);
  }
  return fetchExercisesByBodyPart(bodyPart, limit);
}

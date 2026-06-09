import type { ExerciseDBExercise } from "../lib/exercisedb";
import { pickExercisesForBodyPart, resolveExercisesForBodyPart } from "./exerciseCatalogService";

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type PlanSectionId = "warmup" | "cardio" | "main" | "cooldown";

export interface PlanSectionExercise extends ExerciseDBExercise {
  sets: number;
  repsRange: string;
  restSeconds: number;
  estimatedCaloriesPerSet: number;
  difficulty: string;
  section: PlanSectionId;
  sectionLabel: string;
}

export interface StructuredPlanDay {
  dayName: string;
  focus: string;
  isRest: boolean;
  isCardio: boolean;
  estimatedCalories: number;
  estimatedDuration: string;
  sections: Array<{
    id: PlanSectionId;
    title: string;
    durationMinutes: number;
    exercises: PlanSectionExercise[];
  }>;
  exercises: PlanSectionExercise[];
}

export interface UserMetricsSnapshot {
  bodyFat: string | null;
  bmi: string | null;
  skeletalMuscleMass: string | null;
  visceralFat: string | null;
  weight: string | null;
  targetWeight: string | null;
  hasInBodyReport: boolean;
}

interface TrainingDay {
  dayName: string;
  focus: string;
  bodyParts: string[];
  isCardio: boolean;
  isRest: boolean;
  sets: number;
  repsRange: string;
  restSeconds: number;
}

function toPlanExercise(
  ex: ExerciseDBExercise,
  section: PlanSectionId,
  sectionLabel: string,
  sets: number,
  repsRange: string,
  restSeconds: number,
  calsPerSet: number,
  difficulty: string,
): PlanSectionExercise {
  return {
    ...ex,
    section,
    sectionLabel,
    sets,
    repsRange,
    restSeconds,
    estimatedCaloriesPerSet: calsPerSet,
    difficulty,
  };
}

async function pickUnique(
  bodyPart: string,
  limit: number,
  exclude: Set<string>,
): Promise<ExerciseDBExercise[]> {
  const pool = await resolveExercisesForBodyPart(bodyPart, limit * 3);
  const picked: ExerciseDBExercise[] = [];
  for (const ex of pool) {
    const key = ex.name.toLowerCase();
    if (exclude.has(key)) continue;
    exclude.add(key);
    picked.push(ex);
    if (picked.length >= limit) break;
  }
  return picked;
}

function estimateCals(bodyPart: string): number {
  const map: Record<string, number> = {
    chest: 14,
    back: 16,
    "upper legs": 22,
    "lower legs": 8,
    shoulders: 10,
    "upper arms": 8,
    waist: 8,
    cardio: 45,
  };
  return map[bodyPart] ?? 12;
}

export async function buildStructuredExercisePlan(
  trainingDays: TrainingDay[],
  sessionDuration: string,
): Promise<StructuredPlanDay[]> {
  const plan: StructuredPlanDay[] = [];
  const globalUsed = new Set<string>();
  let dayIndex = 0;

  for (const day of trainingDays) {
    const dayName = day.dayName?.trim() || WEEKDAY_NAMES[dayIndex] || "Monday";
    const focus =
      day.focus?.trim() ||
      (day.isRest ? "Rest" : day.isCardio ? "Cardio" : "Training");
    dayIndex++;

    if (day.isRest) {
      plan.push({
        dayName,
        focus: "Rest",
        isRest: true,
        isCardio: false,
        estimatedCalories: 0,
        estimatedDuration: "—",
        sections: [],
        exercises: [],
      });
      continue;
    }

    const sections: StructuredPlanDay["sections"] = [];
    const dayUsed = new Set(globalUsed);

    if (day.isCardio) {
      const warmup = await pickUnique("waist", 3, dayUsed);
      const cardio = await pickUnique("cardio", 6, dayUsed);
      const cooldown = await pickUnique("waist", 2, dayUsed);

      sections.push({
        id: "warmup",
        title: "Warm-up & Mobility",
        durationMinutes: 5,
        exercises: warmup.map((ex) =>
          toPlanExercise(ex, "warmup", "Warm-up", 1, "5 min", 0, 8, "Beginner"),
        ),
      });
      sections.push({
        id: "cardio",
        title: "Cardio Session",
        durationMinutes: 13,
        exercises: cardio.map((ex) =>
          toPlanExercise(ex, "cardio", "Cardio", 1, "2-3 min", 30, 45, "Beginner"),
        ),
      });
      sections.push({
        id: "cooldown",
        title: "Cool-down Stretch",
        durationMinutes: 5,
        exercises: cooldown.map((ex) =>
          toPlanExercise(ex, "cooldown", "Stretch", 1, "30-45 sec", 0, 6, "Beginner"),
        ),
      });
    } else {
      const warmup = await pickUnique("waist", 3, dayUsed);
      const cardioBurst = await pickUnique("cardio", 4, dayUsed);

      const mainExercises: PlanSectionExercise[] = [];
      const perPart = Math.max(2, Math.ceil(10 / Math.max(day.bodyParts.length, 1)));

      for (const bodyPart of day.bodyParts) {
        const fetched = await pickUnique(bodyPart, perPart, dayUsed);
        for (const ex of fetched) {
          mainExercises.push(
            toPlanExercise(
              ex,
              "main",
              "Strength",
              day.sets,
              day.repsRange,
              day.restSeconds,
              estimateCals(bodyPart),
              day.sets >= 4 ? "Intermediate" : "Beginner",
            ),
          );
        }
      }

      const cooldown = await pickUnique("waist", 2, dayUsed);

      sections.push({
        id: "warmup",
        title: "Warm-up & Activation",
        durationMinutes: 5,
        exercises: warmup.map((ex) =>
          toPlanExercise(ex, "warmup", "Warm-up", 1, "8-10 reps", 0, 8, "Beginner"),
        ),
      });
      sections.push({
        id: "cardio",
        title: "Daily Cardio Burst",
        durationMinutes: 13,
        exercises: cardioBurst.map((ex) =>
          toPlanExercise(ex, "cardio", "Cardio", 1, "3 min", 30, 40, "Beginner"),
        ),
      });
      sections.push({
        id: "main",
        title: "Strength Session",
        durationMinutes: 40,
        exercises: mainExercises,
      });
      sections.push({
        id: "cooldown",
        title: "Cool-down Stretch",
        durationMinutes: 5,
        exercises: cooldown.map((ex) =>
          toPlanExercise(ex, "cooldown", "Stretch", 1, "30-45 sec", 0, 6, "Beginner"),
        ),
      });
    }

    const exercises = sections.flatMap((s) => s.exercises);
    for (const ex of exercises) globalUsed.add(ex.name.toLowerCase());

    const totalCals = exercises.reduce(
      (sum, ex) => sum + ex.estimatedCaloriesPerSet * Math.max(ex.sets, 1),
      0,
    );

    const durationMin = sections.reduce((sum, s) => sum + s.durationMinutes, 0);

    plan.push({
      dayName,
      focus,
      isRest: false,
      isCardio: day.isCardio,
      estimatedCalories: Math.round(totalCals),
      estimatedDuration: day.isCardio ? "23 min" : `${durationMin} min`,
      sections,
      exercises,
    });
  }

  return plan;
}

export function buildMetricsSnapshot(
  metrics: Record<string, string> | null | undefined,
  hasReport: boolean,
): UserMetricsSnapshot {
  return {
    bodyFat: metrics?.bodyFat ?? null,
    bmi: metrics?.bmi ?? null,
    skeletalMuscleMass: metrics?.skeletalMuscleMass ?? null,
    visceralFat: metrics?.visceralFat ?? null,
    weight: metrics?.weight ?? null,
    targetWeight: metrics?.targetWeight ?? null,
    hasInBodyReport: hasReport,
  };
}

export function youtubeTutorialUrl(exerciseName: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${exerciseName} exercise form tutorial`)}`;
}

export function googleTutorialUrl(exerciseName: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${exerciseName} exercise how to`)}`;
}

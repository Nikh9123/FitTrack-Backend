import { db, exerciseLogs, exercises, inbodyReports, personalRecords, userWorkoutSessions } from "../db";
import { and, desc, eq, gte } from "drizzle-orm";

export type ProgressionSuggestionType =
  | "increase_weight"
  | "increase_volume"
  | "body_composition"
  | "consistency"
  | "recovery"
  | "pr_opportunity";

export interface ProgressionSuggestion {
  type: ProgressionSuggestionType;
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
  exerciseName?: string;
  suggestedDelta?: string;
}

function parseNum(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = parseFloat(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function getProgressionSuggestions(userId: string): Promise<ProgressionSuggestion[]> {
  const suggestions: ProgressionSuggestion[] = [];

  const reports = await db
    .select({
      extractedMetrics: inbodyReports.extractedMetrics,
      createdAt: inbodyReports.createdAt,
    })
    .from(inbodyReports)
    .where(eq(inbodyReports.userId, userId))
    .orderBy(desc(inbodyReports.createdAt))
    .limit(2);

  if (reports.length >= 2) {
    const latest = reports[0].extractedMetrics as Record<string, string> | null;
    const previous = reports[1].extractedMetrics as Record<string, string> | null;
    if (latest && previous) {
      const bfNow = parseNum(latest.bodyFat);
      const bfPrev = parseNum(previous.bodyFat);
      const smmNow = parseNum(latest.skeletalMuscleMass);
      const smmPrev = parseNum(previous.skeletalMuscleMass);
      const weightNow = parseNum(latest.weight);
      const weightPrev = parseNum(previous.weight);

      if (bfNow != null && bfPrev != null && bfNow < bfPrev - 0.5) {
        suggestions.push({
          type: "body_composition",
          title: "Fat loss progress",
          message: `Body fat dropped from ${bfPrev.toFixed(1)}% to ${bfNow.toFixed(1)}%. Keep protein high and add 2.5–5 kg on compound lifts where form stays solid.`,
          priority: "high",
          suggestedDelta: "+2.5 kg on compounds",
        });
      }

      if (smmNow != null && smmPrev != null && smmNow > smmPrev + 0.3) {
        suggestions.push({
          type: "body_composition",
          title: "Muscle gain detected",
          message: `Skeletal muscle mass up ${(smmNow - smmPrev).toFixed(1)} kg. You're responding well — try adding one rep per set on upper-body exercises this week.`,
          priority: "high",
          suggestedDelta: "+1 rep per set",
        });
      }

      if (weightNow != null && weightPrev != null && Math.abs(weightNow - weightPrev) >= 1) {
        const delta = weightNow - weightPrev;
        suggestions.push({
          type: "body_composition",
          title: delta < 0 ? "Weight trending down" : "Weight trending up",
          message:
            delta < 0
              ? `Weight down ${Math.abs(delta).toFixed(1)} kg since last InBody. Prioritise strength maintenance — avoid dropping working weights more than 10%.`
              : `Weight up ${delta.toFixed(1)} kg. If lean mass is rising, progress loads on lower-body compounds by 2.5 kg.`,
          priority: "medium",
        });
      }
    }
  } else if (reports.length === 1) {
    suggestions.push({
      type: "body_composition",
      title: "Baseline established",
      message: "Upload a follow-up InBody scan in 4–6 weeks so AI can track fat loss or muscle gain and adjust your plan.",
      priority: "low",
    });
  }

  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

  const sessions = await db
    .select({
      id: userWorkoutSessions.id,
      completedAt: userWorkoutSessions.completedAt,
      totalDuration: userWorkoutSessions.totalDuration,
    })
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        gte(userWorkoutSessions.startedAt, fourWeeksAgo),
      ),
    )
    .orderBy(desc(userWorkoutSessions.completedAt))
    .limit(20);

  const completed = sessions.filter((s) => s.completedAt);
  if (completed.length >= 4) {
    suggestions.push({
      type: "consistency",
      title: "Strong consistency",
      message: `${completed.length} workouts logged in the last 4 weeks. You're ready to add 2.5 kg on exercises where you hit all prescribed reps for 2 sessions in a row.`,
      priority: "medium",
      suggestedDelta: "+2.5 kg",
    });
  } else if (completed.length === 0) {
    suggestions.push({
      type: "consistency",
      title: "Build your baseline",
      message: "Log 3 workouts this week to unlock personalised load progression suggestions.",
      priority: "high",
    });
  }

  const prs = await db
    .select({
      maxWeight: personalRecords.maxWeight,
      maxReps: personalRecords.maxReps,
      exerciseName: exercises.name,
      updatedAt: personalRecords.updatedAt,
    })
    .from(personalRecords)
    .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
    .where(eq(personalRecords.userId, userId))
    .orderBy(desc(personalRecords.updatedAt))
    .limit(5);

  for (const pr of prs) {
    const weight = parseFloat(String(pr.maxWeight ?? 0));
    if (weight > 0) {
      suggestions.push({
        type: "pr_opportunity",
        title: `Progress ${pr.exerciseName}`,
        message: `Your PR is ${weight} kg. Try ${weight + 2.5} kg × ${Math.max(6, (pr.maxReps ?? 8) - 1)} reps on your next session.`,
        priority: "medium",
        exerciseName: pr.exerciseName,
        suggestedDelta: `+2.5 kg → ${weight + 2.5} kg`,
      });
      break;
    }
  }

  const recentLogs = await db
    .select({
      weight: exerciseLogs.weight,
      reps: exerciseLogs.reps,
      exerciseName: exercises.name,
      loggedAt: exerciseLogs.loggedAt,
    })
    .from(exerciseLogs)
    .innerJoin(userWorkoutSessions, eq(exerciseLogs.workoutSessionId, userWorkoutSessions.id))
    .innerJoin(exercises, eq(exerciseLogs.exerciseId, exercises.id))
    .where(eq(userWorkoutSessions.userId, userId))
    .orderBy(desc(exerciseLogs.loggedAt))
    .limit(30);

  const byExercise = new Map<string, Array<{ weight: number; reps: number }>>();
  for (const log of recentLogs) {
    const w = parseFloat(String(log.weight ?? 0));
    const r = log.reps ?? 0;
    if (w <= 0 || r <= 0) continue;
    const list = byExercise.get(log.exerciseName) ?? [];
    list.push({ weight: w, reps: r });
    byExercise.set(log.exerciseName, list);
  }

  for (const [name, sets] of byExercise) {
    if (sets.length < 3) continue;
    const lastThree = sets.slice(0, 3);
    const sameWeight = lastThree.every((s) => s.weight === lastThree[0].weight);
    const hitReps = lastThree.every((s) => s.reps >= 10);
    if (sameWeight && hitReps) {
      suggestions.push({
        type: "increase_weight",
        title: `Level up: ${name}`,
        message: `You hit ${lastThree[0].weight} kg for ${lastThree[0].reps}+ reps on your last sets. Increase to ${lastThree[0].weight + 2.5} kg next session.`,
        priority: "high",
        exerciseName: name,
        suggestedDelta: `+2.5 kg → ${lastThree[0].weight + 2.5} kg`,
      });
      break;
    }
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return suggestions
    .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
    .slice(0, 6);
}

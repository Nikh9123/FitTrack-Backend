import { db } from "../db";
import { eq, and, desc, sql, gte, lt } from "drizzle-orm";
import {
  userWorkoutPlans,
  userWorkoutExercises,
  userWorkoutSessions,
  exerciseLogs,
  personalRecords,
  activityInsights,
  exercises,
  userProfiles,
} from "../db";
import { logger } from "../lib/logger";

/**
 * Workout Persistence and Tracking Service
 */

/** Parse a date into a clean YYYY-MM-DD string in local time */
function toLocalDateString(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Get a Date object minus N days */
function subtractDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * 1. Upsert a generated or template exercise into the exercises table
 */
export async function findOrCreateExercise(ex: {
  id?: string;
  name: string;
  bodyPart?: string;
  target?: string;
  secondaryMuscles?: string[];
  equipment?: string;
  gifUrl?: string;
  instructions?: string | string[];
}): Promise<string> {
  const normalisedName = ex.name.trim();

  // Try finding by name or source ID
  let [dbEx] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.name, normalisedName))
    .limit(1);

  if (dbEx) {
    return dbEx.id;
  }

  // Fallback to searching by source ID if provided
  if (ex.id) {
    const [dbExById] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.sourceExerciseId, ex.id))
      .limit(1);
    if (dbExById) return dbExById.id;
  }

  // Insert a new exercise if not found
  logger.info({ name: normalisedName }, "Upserting new exercise into DB");
  const cleanInstructions = Array.isArray(ex.instructions)
    ? ex.instructions.join("\n")
    : (ex.instructions || "");

  const [inserted] = await db
    .insert(exercises)
    .values({
      name: normalisedName,
      bodyPart: ex.bodyPart || "Cardio",
      targetMuscle: ex.target || null,
      secondaryMuscles: ex.secondaryMuscles || [],
      equipment: ex.equipment ? [ex.equipment] : [],
      gifUrl: ex.gifUrl || "",
      instructions: cleanInstructions,
      source: "exercisedb",
      sourceExerciseId: ex.id || null,
    })
    .returning();

  return inserted.id;
}

/**
 * 2. Backfill workout plan from user onboardingData if missing in DB
 */
export async function backfillPlanFromOnboarding(userId: string): Promise<string | null> {
  try {
    const [profile] = await db
      .select({ onboardingData: userProfiles.onboardingData, fitnessGoal: userProfiles.fitnessGoal })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);

    if (!profile || !profile.onboardingData) return null;

    const data = profile.onboardingData as any;
    const rawPlan = data.generatedWorkoutPlan;
    const strategy = data.workoutStrategy;

    if (!rawPlan || !Array.isArray(rawPlan) || rawPlan.length === 0) {
      return null;
    }

    logger.info({ userId }, "Backfilling onboarding workout plan to SQL DB");

    // Insert user workout plan
    const title = `${profile.fitnessGoal || data.selectedGoal || "My AI"} Workout Plan`;
    const [plan] = await db
      .insert(userWorkoutPlans)
      .values({
        userId,
        title,
        goal: profile.fitnessGoal || data.selectedGoal || null,
        category: strategy?.split || "Full Body",
        estimatedDuration: strategy?.sessionDuration || "45-55 min",
        aiGenerated: true,
      })
      .returning();

    let orderIndex = 0;
    for (const day of rawPlan) {
      if (day.isRest || !day.exercises || !Array.isArray(day.exercises)) continue;

      for (const ex of day.exercises) {
        const exerciseId = await findOrCreateExercise({
          id: ex.id,
          name: ex.name,
          bodyPart: ex.bodyPart,
          target: ex.target,
          secondaryMuscles: ex.secondaryMuscles,
          equipment: ex.equipment,
          gifUrl: ex.gifUrl,
          instructions: ex.instructions,
        });

        // Insert user workout exercise
        await db.insert(userWorkoutExercises).values({
          workoutPlanId: plan.id,
          exerciseId,
          exerciseName: ex.name,
          dayName: day.dayName,
          sets: ex.sets || 3,
          reps: ex.repsRange || "10-12",
          calories: Math.round((ex.estimatedCaloriesPerSet || 12) * (ex.sets || 3)),
          equipment: ex.equipment || null,
          muscleGroup: ex.bodyPart || null,
          orderIndex: orderIndex++,
        });
      }
    }

    return plan.id;
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to backfill onboarding plan");
    return null;
  }
}

/**
 * 3. Persist onboarding plan explicitly when saveOnboarding is called
 */
export async function saveOnboardingPlanDirectly(
  userId: string,
  goal: string,
  workoutPlan: any[],
  strategy: any,
): Promise<string | null> {
  try {
    if (!Array.isArray(workoutPlan) || workoutPlan.length === 0) return null;

    logger.info({ userId }, "Persisting newly generated AI workout plan directly to SQL tables");

    // Deactivate previous plans if any
    // (We simply delete old user plans for a fresh setup, keeping historical sessions intact)
    const oldPlans = await db
      .select({ id: userWorkoutPlans.id })
      .from(userWorkoutPlans)
      .where(eq(userWorkoutPlans.userId, userId));

    for (const oldPlan of oldPlans) {
      await db.delete(userWorkoutPlans).where(eq(userWorkoutPlans.id, oldPlan.id));
    }

    const title = `${goal} Workout Plan`;
    const [plan] = await db
      .insert(userWorkoutPlans)
      .values({
        userId,
        title,
        goal,
        category: strategy?.split || "Full Body",
        estimatedDuration: strategy?.sessionDuration || "45-55 min",
        aiGenerated: true,
      })
      .returning();

    let orderIndex = 0;
    for (const day of workoutPlan) {
      if (day.isRest || !day.exercises || !Array.isArray(day.exercises)) continue;

      for (const ex of day.exercises) {
        const exerciseId = await findOrCreateExercise({
          id: ex.id,
          name: ex.name,
          bodyPart: ex.bodyPart,
          target: ex.target,
          secondaryMuscles: ex.secondaryMuscles,
          equipment: ex.equipment,
          gifUrl: ex.gifUrl,
          instructions: ex.instructions,
        });

        await db.insert(userWorkoutExercises).values({
          workoutPlanId: plan.id,
          exerciseId,
          exerciseName: ex.name,
          dayName: day.dayName,
          sets: ex.sets || 3,
          reps: ex.repsRange || "10-12",
          calories: Math.round((ex.estimatedCaloriesPerSet || 12) * (ex.sets || 3)),
          equipment: ex.equipment || null,
          muscleGroup: ex.bodyPart || null,
          orderIndex: orderIndex++,
        });
      }
    }

    return plan.id;
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to persist AI plan directly");
    return null;
  }
}

/**
 * 4. GET /api/workouts/current
 */
export async function getCurrentWorkoutPlan(userId: string) {
  // Find standard persisted plan
  let [plan] = await db
    .select()
    .from(userWorkoutPlans)
    .where(eq(userWorkoutPlans.userId, userId))
    .orderBy(desc(userWorkoutPlans.createdAt))
    .limit(1);

  if (!plan) {
    // Attempt auto-backfill from onboarding JSON data
    const backfilledId = await backfillPlanFromOnboarding(userId);
    if (backfilledId) {
      [plan] = await db
        .select()
        .from(userWorkoutPlans)
        .where(eq(userWorkoutPlans.id, backfilledId))
        .limit(1);
    }
  }

  if (!plan) {
    return null;
  }

  // Fetch exercises associated with this plan
  const planExercises = await db
    .select()
    .from(userWorkoutExercises)
    .where(eq(userWorkoutExercises.workoutPlanId, plan.id))
    .orderBy(userWorkoutExercises.orderIndex);

  return {
    ...plan,
    exercises: planExercises,
  };
}

/**
 * 5. POST /api/workouts/session/start
 */
export async function startWorkoutSession(userId: string, workoutPlanId: string | null) {
  logger.info({ userId, workoutPlanId }, "Starting workout session");

  const [session] = await db
    .insert(userWorkoutSessions)
    .values({
      userId,
      workoutPlanId,
      startedAt: new Date(),
    })
    .returning();

  return session;
}

/**
 * 6. POST /api/workouts/session/log
 */
export async function logExercise(payload: {
  userId: string;
  workoutSessionId: string;
  exerciseId: string;
  weight: number;
  reps: number;
  setsCompleted: number;
  duration?: number;
  notes?: string;
}) {
  logger.info(payload, "Logging exercise set");

  // Insert the exercise log
  const [log] = await db
    .insert(exerciseLogs)
    .values({
      workoutSessionId: payload.workoutSessionId,
      exerciseId: payload.exerciseId,
      weight: String(payload.weight),
      reps: payload.reps,
      setsCompleted: payload.setsCompleted,
      duration: payload.duration || null,
      notes: payload.notes || null,
    })
    .returning();

  // Track and update personal record
  let newPersonalRecord = false;
  const [existingPr] = await db
    .select()
    .from(personalRecords)
    .where(
      and(
        eq(personalRecords.userId, payload.userId),
        eq(personalRecords.exerciseId, payload.exerciseId),
      ),
    )
    .limit(1);

  if (!existingPr) {
    await db.insert(personalRecords).values({
      userId: payload.userId,
      exerciseId: payload.exerciseId,
      maxWeight: String(payload.weight),
      maxReps: payload.reps,
    });
    newPersonalRecord = true;
  } else {
    const prevWeight = parseFloat(existingPr.maxWeight);
    if (
      payload.weight > prevWeight ||
      (payload.weight === prevWeight && payload.reps > existingPr.maxReps)
    ) {
      await db
        .update(personalRecords)
        .set({
          maxWeight: String(payload.weight),
          maxReps: payload.reps,
          updatedAt: new Date(),
        })
        .where(eq(personalRecords.id, existingPr.id));
      newPersonalRecord = true;
    }
  }

  return {
    log,
    newPersonalRecord,
  };
}

/**
 * 7. POST /api/workouts/session/complete
 */
export async function completeWorkoutSession(
  userId: string,
  workoutSessionId: string,
  totalDuration: number,
  caloriesBurned = 250,
) {
  logger.info({ userId, workoutSessionId }, "Completing workout session");

  // Fetch the session
  const [session] = await db
    .select()
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.id, workoutSessionId),
        eq(userWorkoutSessions.userId, userId),
      ),
    )
    .limit(1);

  if (!session) {
    throw new Error("Workout session not found");
  }

  // Get logged exercises
  const logged = await db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.workoutSessionId, workoutSessionId));

  // Determine completion percentage based on current day's plan
  let completionPercentage = 100;
  if (session.workoutPlanId) {
    const todayName = new Date().toLocaleDateString("en-US", { weekday: "long" }); // e.g. "Monday"
    const plannedExercises = await db
      .select({ exerciseId: userWorkoutExercises.exerciseId })
      .from(userWorkoutExercises)
      .where(
        and(
          eq(userWorkoutExercises.workoutPlanId, session.workoutPlanId),
          eq(userWorkoutExercises.dayName, todayName),
        ),
      );

    if (plannedExercises.length > 0) {
      const plannedIds = new Set(plannedExercises.map((e) => e.exerciseId));
      const loggedIds = new Set(logged.map((l) => l.exerciseId));

      let matched = 0;
      plannedIds.forEach((id) => {
        if (loggedIds.has(id)) matched++;
      });

      completionPercentage = Math.round((matched / plannedIds.size) * 100);
    }
  }

  // Close the session
  const [completedSession] = await db
    .update(userWorkoutSessions)
    .set({
      completedAt: new Date(),
      totalDuration,
      caloriesBurned,
      completionPercentage,
    })
    .where(eq(userWorkoutSessions.id, workoutSessionId))
    .returning();

  // Recalculate activity insights
  await recalculateActivityInsights(userId);

  return completedSession;
}

/** Helper to compute active streaks and update stats */
async function recalculateActivityInsights(userId: string) {
  try {
    // 1. Fetch completed sessions
    const completed = await db
      .select({ completedAt: userWorkoutSessions.completedAt, caloriesBurned: userWorkoutSessions.caloriesBurned })
      .from(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.userId, userId),
          sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(userWorkoutSessions.completedAt));

    const totalCompletedCount = completed.length;

    // 2. Weekly / Monthly calories
    const now = new Date();
    const oneWeekAgo = subtractDays(now, 7);
    const oneMonthAgo = subtractDays(now, 30);

    let weeklyCals = 0;
    let monthlyCals = 0;

    for (const session of completed) {
      const compDate = new Date(session.completedAt!);
      const cals = session.caloriesBurned ?? 0;

      if (compDate >= oneWeekAgo) weeklyCals += cals;
      if (compDate >= oneMonthAgo) monthlyCals += cals;
    }

    // 3. Compute Streak
    const activeDates = Array.from(
      new Set(
        completed
          .filter((s) => s.completedAt)
          .map((s) => toLocalDateString(new Date(s.completedAt!))),
      ),
    ).sort((a, b) => b.localeCompare(a)); // sorted descending

    let currentStreak = 0;
    if (activeDates.length > 0) {
      const todayStr = toLocalDateString(now);
      const yesterdayStr = toLocalDateString(subtractDays(now, 1));
      const latestActiveDate = activeDates[0];

      // Streak is active if worked out today or yesterday
      if (latestActiveDate === todayStr || latestActiveDate === yesterdayStr) {
        currentStreak = 1;
        let expectedDate = subtractDays(new Date(latestActiveDate), 1);

        for (let i = 1; i < activeDates.length; i++) {
          const expectedStr = toLocalDateString(expectedDate);
          if (activeDates[i] === expectedStr) {
            currentStreak++;
            expectedDate = subtractDays(expectedDate, 1);
          } else {
            break;
          }
        }
      }
    }

    // 4. Calculate total volume
    // Fetch all logs to calculate total volume lifted
    const allSessions = await db
      .select({ id: userWorkoutSessions.id })
      .from(userWorkoutSessions)
      .where(eq(userWorkoutSessions.userId, userId));

    let totalVolume = 0;
    if (allSessions.length > 0) {
      const sessionIds = allSessions.map((s) => s.id);
      const allLogs = await db
        .select({ weight: exerciseLogs.weight, reps: exerciseLogs.reps, sets: exerciseLogs.setsCompleted })
        .from(exerciseLogs)
        .where(sql`${exerciseLogs.workoutSessionId} IN ${sessionIds}`);

      for (const log of allLogs) {
        const wt = parseFloat(log.weight || "0");
        const reps = log.reps || 0;
        const sets = log.sets || 1;
        totalVolume += wt * reps * sets;
      }
    }

    // 5. Update or insert Activity Insights table
    const [existingInsight] = await db
      .select()
      .from(activityInsights)
      .where(eq(activityInsights.userId, userId))
      .limit(1);

    if (existingInsight) {
      await db
        .update(activityInsights)
        .set({
          weeklyCalories: weeklyCals,
          monthlyCalories: monthlyCals,
          streakDays: currentStreak,
          workoutsCompleted: totalCompletedCount,
          totalVolumeLifted: String(Math.round(totalVolume)),
        })
        .where(eq(activityInsights.id, existingInsight.id));
    } else {
      await db.insert(activityInsights).values({
        userId,
        weeklyCalories: weeklyCals,
        monthlyCalories: monthlyCals,
        streakDays: currentStreak,
        workoutsCompleted: totalCompletedCount,
        totalVolumeLifted: String(Math.round(totalVolume)),
      });
    }

    logger.info({ userId, streak: currentStreak, totalVolume }, "Recalculated activity insights successfully");
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to recalculate activity insights");
  }
}

/**
 * 8. GET /api/workouts/history
 */
export async function getWorkoutHistory(userId: string, limit = 10, offset = 0) {
  // Fetch sessions
  const sessions = await db
    .select()
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(userWorkoutSessions.completedAt))
    .limit(limit)
    .offset(offset);

  const enrichedSessions = [];
  for (const session of sessions) {
    const logs = await db
      .select({
        logId: exerciseLogs.id,
        weight: exerciseLogs.weight,
        reps: exerciseLogs.reps,
        setsCompleted: exerciseLogs.setsCompleted,
        loggedAt: exerciseLogs.loggedAt,
        exerciseId: exercises.id,
        exerciseName: exercises.name,
        bodyPart: exercises.bodyPart,
      })
      .from(exerciseLogs)
      .innerJoin(exercises, eq(exerciseLogs.exerciseId, exercises.id))
      .where(eq(exerciseLogs.workoutSessionId, session.id));

    enrichedSessions.push({
      ...session,
      logs,
    });
  }

  return enrichedSessions;
}

/**
 * 9. GET /api/workouts/insights
 */
export async function getWorkoutInsights(userId: string) {
  const [insight] = await db
    .select()
    .from(activityInsights)
    .where(eq(activityInsights.userId, userId))
    .limit(1);

  const completedSessions = await db
    .select()
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(userWorkoutSessions.completedAt));

  const now = new Date();
  const oneWeekAgo = subtractDays(now, 7);
  const twoWeeksAgo = subtractDays(now, 14);

  // Volume calculations for growth
  let thisWeekVolume = 0;
  let lastWeekVolume = 0;

  // Track calories burned per day for trends (last 7 days)
  const calorieTrend: Record<string, number> = {};
  for (let i = 0; i < 7; i++) {
    const dateStr = toLocalDateString(subtractDays(now, i));
    calorieTrend[dateStr] = 0;
  }

  // Muscle group frequency based on last 30 days
  const muscleFrequency: Record<string, number> = {};

  for (const session of completedSessions) {
    const compDate = new Date(session.completedAt!);

    // Trend mapping
    const dateStr = toLocalDateString(compDate);
    if (calorieTrend[dateStr] !== undefined) {
      calorieTrend[dateStr] += session.caloriesBurned ?? 0;
    }

    // Volume calculation
    const logs = await db
      .select({
        weight: exerciseLogs.weight,
        reps: exerciseLogs.reps,
        sets: exerciseLogs.setsCompleted,
        bodyPart: exercises.bodyPart,
      })
      .from(exerciseLogs)
      .innerJoin(exercises, eq(exerciseLogs.exerciseId, exercises.id))
      .where(eq(exerciseLogs.workoutSessionId, session.id));

    const sessionVol = logs.reduce((sum, log) => {
      const wt = parseFloat(log.weight || "0");
      const reps = log.reps || 0;
      const sets = log.sets || 1;
      return sum + wt * reps * sets;
    }, 0);

    if (compDate >= oneWeekAgo) {
      thisWeekVolume += sessionVol;
    } else if (compDate >= twoWeeksAgo && compDate < oneWeekAgo) {
      lastWeekVolume += sessionVol;
    }

    // Muscle grouping (last 30 days)
    if (compDate >= subtractDays(now, 30)) {
      logs.forEach((log) => {
        const bp = log.bodyPart || "Cardio";
        muscleFrequency[bp] = (muscleFrequency[bp] || 0) + 1;
      });
    }
  }

  // Calculate volume growth percentage
  let growthText = "You lifted 100% more this week! Fresh start!";
  if (lastWeekVolume > 0) {
    const pct = Math.round(((thisWeekVolume - lastWeekVolume) / lastWeekVolume) * 100);
    if (pct > 0) {
      growthText = `You lifted ${pct}% more volume this week compared to last week! Keep thriving!`;
    } else if (pct < 0) {
      growthText = `You lifted ${Math.abs(pct)}% less volume this week. Stay consistent!`;
    } else {
      growthText = `Your volume matches last week perfectly. Focus on progression!`;
    }
  }

  // PR alert
  const [latestPr] = await db
    .select({
      maxWeight: personalRecords.maxWeight,
      exerciseName: exercises.name,
      updatedAt: personalRecords.updatedAt,
    })
    .from(personalRecords)
    .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
    .where(eq(personalRecords.userId, userId))
    .orderBy(desc(personalRecords.updatedAt))
    .limit(1);

  let prText = "Keep pushing to log your first exercise Personal Record!";
  if (latestPr) {
    prText = `New Personal Record on ${latestPr.exerciseName}: lifted ${latestPr.maxWeight}kg!`;
  }

  const streakVal = insight?.streakDays ?? 0;

  return {
    summary: {
      weeklyCalories: insight?.weeklyCalories ?? 0,
      monthlyCalories: insight?.monthlyCalories ?? 0,
      streakDays: streakVal,
      workoutsCompleted: insight?.workoutsCompleted ?? 0,
      totalVolumeLifted: insight?.totalVolumeLifted ?? "0",
    },
    funInsights: [
      growthText,
      prText,
      streakVal > 0 ? `${streakVal} day workout streak! Keep up the flame!` : "Start logging workouts to build a consistent streak!",
    ],
    calorieTrend: Object.keys(calorieTrend)
      .map((date) => ({ date, calories: calorieTrend[date] }))
      .reverse(),
    muscleFrequency,
    thisWeekVolume,
    lastWeekVolume,
  };
}

/**
 * 10. GET /api/workouts/personal-records
 */
export async function getPersonalRecords(userId: string) {
  const prs = await db
    .select({
      id: personalRecords.id,
      maxWeight: personalRecords.maxWeight,
      maxReps: personalRecords.maxReps,
      updatedAt: personalRecords.updatedAt,
      exerciseId: exercises.id,
      exerciseName: exercises.name,
      bodyPart: exercises.bodyPart,
      equipment: exercises.equipment,
    })
    .from(personalRecords)
    .innerJoin(exercises, eq(personalRecords.exerciseId, exercises.id))
    .where(eq(personalRecords.userId, userId))
    .orderBy(desc(personalRecords.updatedAt));

  return prs;
}

/**
 * 11. GET /api/workouts/streaks
 */
export async function getStreakDetails(userId: string) {
  const [insight] = await db
    .select({ streakDays: activityInsights.streakDays, workoutsCompleted: activityInsights.workoutsCompleted })
    .from(activityInsights)
    .where(eq(activityInsights.userId, userId))
    .limit(1);

  // Fetch all completed workout dates in the last 30 days
  const completed = await db
    .select({ completedAt: userWorkoutSessions.completedAt })
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
        gte(userWorkoutSessions.completedAt, subtractDays(new Date(), 30)),
      ),
    );

  const activeDates = Array.from(
    new Set(
      completed
        .filter((s) => s.completedAt)
        .map((s) => toLocalDateString(new Date(s.completedAt!))),
    ),
  );

  // Consistency score: percentage of active days in last 30 days
  const consistencyScore = Math.round((activeDates.length / 30) * 100);

  return {
    currentStreak: insight?.streakDays ?? 0,
    totalWorkouts: insight?.workoutsCompleted ?? 0,
    activeDaysLast30Days: activeDates,
    consistencyScore,
  };
}

/** Find the most recent active session, or create one if none exists */
export async function findOrCreateActiveSession(userId: string): Promise<string> {
  const [active] = await db
    .select()
    .from(userWorkoutSessions)
    .where(
      and(
        eq(userWorkoutSessions.userId, userId),
        sql`${userWorkoutSessions.completedAt} IS NULL`
      )
    )
    .orderBy(desc(userWorkoutSessions.startedAt))
    .limit(1);

  if (active) {
    return active.id;
  }

  const newSession = await startWorkoutSession(userId, null);
  return newSession.id;
}

import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import { db, userProfiles, exercises, userWorkoutSessions } from "../db";
import { eq, and, sql } from "drizzle-orm";
import * as workoutService from "../services/workoutService";
import { getWorkoutPlanContext } from "../services/workoutPlanSourceService";
import { getProgressionSuggestions } from "../services/progressionSuggestionService";
import { getCatalogCount, searchExercisesFromCatalog, getExercisesByCategory } from "../services/exerciseCatalogService";
import { googleTutorialUrl, youtubeTutorialUrl } from "../services/workoutPlanBuilderService";

/**
 * Helper to validate UUID format
 */
function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * GET /api/workouts/current
 */
export async function getCurrentPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const [plan, planContext, catalogCount] = await Promise.all([
      workoutService.getCurrentWorkoutPlan(userId),
      getWorkoutPlanContext(userId),
      getCatalogCount(),
    ]);
    return res.json({ success: true, plan, planContext, catalogExerciseCount: catalogCount });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get current workout plan");
    return res.status(500).json({ success: false, error: "Failed to fetch current plan" });
  }
}

/**
 * POST /api/workouts/session/start
 */
export async function startSession(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { workoutPlanId } = req.body as { workoutPlanId?: string };

  if (workoutPlanId && !isValidUuid(workoutPlanId)) {
    return res.status(400).json({ success: false, error: "Invalid workoutPlanId format" });
  }

  try {
    const session = await workoutService.startWorkoutSession(userId, workoutPlanId || null);
    return res.status(201).json({ success: true, session });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to start workout session");
    return res.status(500).json({ success: false, error: "Failed to start workout session" });
  }
}

/**
 * POST /api/workouts/session/log
 */
export async function logExerciseSet(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  
  // Log request body for deep inspection
  logger.info({ body: req.body, userId }, "logExerciseSet request received");

  const { workoutSessionId, exerciseId, exerciseName, weight, reps, setsCompleted = 1, duration, notes } = req.body as {
    workoutSessionId: string;
    exerciseId: string;
    exerciseName?: string;
    weight: any;
    reps: any;
    setsCompleted?: any;
    duration?: any;
    notes?: string;
  };

  let finalSessionId = workoutSessionId;

  if (!finalSessionId || finalSessionId === "undefined" || finalSessionId === "null" || !isValidUuid(finalSessionId)) {
    logger.info({ userId, workoutSessionId }, "workoutSessionId is missing or invalid. Attempting to auto-resolve or start session on the fly.");
    try {
      finalSessionId = await workoutService.findOrCreateActiveSession(userId);
      logger.info({ finalSessionId }, "Successfully resolved session on the fly");
    } catch (sessionErr: any) {
      logger.error({ sessionErr: sessionErr.message, userId }, "Failed to auto-resolve active session");
      return res.status(400).json({ success: false, error: "Missing or invalid workoutSessionId, and failed to start a new session" });
    }
  }

  let finalExerciseId = exerciseId;

  if (!finalExerciseId) {
    logger.warn("logExerciseSet validation failed: exerciseId is missing");
    return res.status(400).json({ success: false, error: "Missing exerciseId" });
  }

  if (!isValidUuid(finalExerciseId)) {
    logger.info({ exerciseId: finalExerciseId }, "exerciseId is not a valid UUID. Attempting to resolve via sourceExerciseId");
    try {
      const [dbEx] = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(eq(exercises.sourceExerciseId, finalExerciseId))
        .limit(1);

      if (dbEx) {
        finalExerciseId = dbEx.id;
        logger.info({ exerciseId, finalExerciseId }, "Successfully resolved ExerciseDB ID to database UUID");
      } else if (exerciseName?.trim()) {
        finalExerciseId = await workoutService.findOrCreateExercise({
          id: exerciseId,
          name: exerciseName.trim(),
        });
        logger.info({ exerciseId, exerciseName, finalExerciseId }, "Resolved exercise via name lookup/creation");
      } else {
        logger.warn({ exerciseId }, "Failed to resolve ExerciseDB ID: not found in exercises table");
        return res.status(404).json({ success: false, error: "Exercise not found" });
      }
    } catch (err: any) {
      logger.error({ err: err.message, exerciseId }, "Error resolving ExerciseDB ID");
      return res.status(500).json({ success: false, error: "Error locating exercise" });
    }
  }

  // Resilient parsing of numeric values
  const numWeight = typeof weight === "number" ? weight : parseFloat(String(weight));
  const numReps = typeof reps === "number" ? reps : parseInt(String(reps), 10);
  const numSetsCompleted = typeof setsCompleted === "number" ? setsCompleted : parseInt(String(setsCompleted), 10);
  const numDuration = duration !== undefined ? (typeof duration === "number" ? duration : parseInt(String(duration), 10)) : undefined;

  if (weight === undefined || isNaN(numWeight) || numWeight < 0) {
    logger.warn({ weight, numWeight }, "logExerciseSet validation failed: weight is invalid");
    return res.status(400).json({ success: false, error: "Weight must be a positive number" });
  }
  if (reps === undefined || isNaN(numReps) || numReps < 0) {
    logger.warn({ reps, numReps }, "logExerciseSet validation failed: reps is invalid");
    return res.status(400).json({ success: false, error: "Reps must be a positive integer" });
  }
  if (isNaN(numSetsCompleted) || numSetsCompleted < 1) {
    logger.warn({ setsCompleted, numSetsCompleted }, "logExerciseSet validation failed: setsCompleted is invalid");
    return res.status(400).json({ success: false, error: "setsCompleted must be an integer >= 1" });
  }

  try {
    const result = await workoutService.logExercise({
      userId,
      workoutSessionId: finalSessionId,
      exerciseId: finalExerciseId,
      weight: numWeight,
      reps: numReps,
      setsCompleted: numSetsCompleted,
      duration: numDuration,
      notes,
    });
    return res.status(201).json({ success: true, ...result, workoutSessionId: finalSessionId });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to log exercise set");
    return res.status(500).json({ success: false, error: "Failed to log exercise" });
  }
}

/**
 * POST /api/workouts/session/complete
 */
export async function completeSession(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { workoutSessionId, totalDuration, caloriesBurned } = req.body as {
    workoutSessionId: string;
    totalDuration: number;
    caloriesBurned?: number;
  };

  if (!workoutSessionId || !isValidUuid(workoutSessionId)) {
    return res.status(400).json({ success: false, error: "Missing or invalid workoutSessionId" });
  }
  if (totalDuration === undefined || typeof totalDuration !== "number" || totalDuration < 0) {
    return res.status(400).json({ success: false, error: "totalDuration must be a positive number of seconds" });
  }

  try {
    const session = await workoutService.completeWorkoutSession(
      userId,
      workoutSessionId,
      totalDuration,
      caloriesBurned,
    );
    return res.json({ success: true, session });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to complete workout session");
    return res.status(500).json({ success: false, error: err.message || "Failed to complete workout session" });
  }
}

/**
 * GET /api/workouts/history
 */
export async function getHistory(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = parseInt(req.query.offset as string) || 0;

  try {
    const history = await workoutService.getWorkoutHistory(userId, limit, offset);
    return res.json({ success: true, history });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to fetch workout history");
    return res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
}

/**
 * GET /api/workouts/insights
 */
export async function getInsights(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const insights = await workoutService.getWorkoutInsights(userId);
    return res.json({ success: true, insights });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to fetch workout insights");
    return res.status(500).json({ success: false, error: "Failed to fetch insights" });
  }
}

/**
 * GET /api/workouts/personal-records
 */
export async function getPRs(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const records = await workoutService.getPersonalRecords(userId);
    return res.json({ success: true, records });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to fetch personal records");
    return res.status(500).json({ success: false, error: "Failed to fetch personal records" });
  }
}

/**
 * GET /api/workouts/streaks
 */
export async function getStreaks(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const details = await workoutService.getStreakDetails(userId);
    return res.json({ success: true, ...details });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to fetch streak details");
    return res.status(500).json({ success: false, error: "Failed to fetch streak details" });
  }
}

/**
 * POST /api/workout/persist
 */
export async function persistWorkoutPlan(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { goal, workoutPlan, strategy } = req.body as {
    goal: string;
    workoutPlan?: any[];
    strategy?: any;
  };

  logger.info({ body: req.body, userId }, "persistWorkoutPlan request received");

  let planGoal = goal;
  if (!planGoal || planGoal.trim() === "") {
    try {
      const [profile] = await db
        .select({ fitnessGoal: userProfiles.fitnessGoal })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      planGoal = profile?.fitnessGoal || "General Fitness";
      logger.info({ planGoal }, "Missing goal backfilled from user profile successfully");
    } catch (dbErr: any) {
      planGoal = "General Fitness";
      logger.warn({ dbErr: dbErr.message }, "Failed to backfill missing goal from DB, using fallback");
    }
  }

  try {
    const planId = await workoutService.saveOnboardingPlanDirectly(
      userId,
      planGoal,
      workoutPlan || [],
      strategy
    );
    if (!planId) {
      return res.status(500).json({ success: false, error: "Failed to persist workout plan" });
    }
    return res.json({ success: true, planId });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to persist workout plan");
    return res.status(500).json({ success: false, error: "Failed to persist workout plan" });
  }
}

/**
 * DELETE /api/workouts/session/:id
 */
export async function cancelSession(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const id = req.params.id as string;

  if (!id || !isValidUuid(id)) {
    logger.warn({ id }, "cancelSession validation failed: id is not a valid UUID");
    return res.status(400).json({ success: false, error: "Invalid session ID format" });
  }

  try {
    await db
      .delete(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.id, id),
          eq(userWorkoutSessions.userId, userId)
        )
      );

    logger.info({ id, userId }, "Workout session cancelled and deleted");
    return res.json({ success: true, message: "Workout session cancelled" });
  } catch (err: any) {
    logger.error({ err: err.message, id, userId }, "Failed to cancel workout session");
    return res.status(500).json({ success: false, error: "Failed to cancel workout session" });
  }
}

/**
 * DELETE /api/workouts/session or POST /api/workouts/session/cancel
 */
export async function cancelCurrentActiveSession(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    await db
      .delete(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.userId, userId),
          sql`${userWorkoutSessions.completedAt} IS NULL`
        )
      );

    logger.info({ userId }, "Active workout session cancelled and deleted");
    return res.json({ success: true, message: "Active workout session cancelled" });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to cancel active session");
    return res.status(500).json({ success: false, error: "Failed to cancel active session" });
  }
}

/**
 * GET /api/workouts/plan-context
 */
export async function getPlanContext(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const planContext = await getWorkoutPlanContext(userId);
    const catalogCount = await getCatalogCount();
    return res.json({ success: true, ...planContext, catalogExerciseCount: catalogCount });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get workout plan context");
    return res.status(500).json({ success: false, error: "Failed to get plan context" });
  }
}

/**
 * GET /api/workouts/progression-suggestions
 */
export async function getProgressionSuggestionsHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const suggestions = await getProgressionSuggestions(userId);
    return res.json({ success: true, suggestions });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get progression suggestions");
    return res.status(500).json({ success: false, error: "Failed to get progression suggestions" });
  }
}

/**
 * GET /api/exercises/search
 */
export async function searchExercisesHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { q, bodyPart, equipment, limit, offset, markPlan } = req.query as Record<string, string | undefined>;
  try {
    const rows = await searchExercisesFromCatalog({
      query: q,
      bodyPart,
      equipment,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });

    let planNames = new Set<string>();
    if (markPlan === "true") {
      const plan = await workoutService.getCurrentWorkoutPlan(userId);
      for (const ex of plan?.exercises ?? []) {
        planNames.add((ex.exerciseName ?? "").toLowerCase());
      }
    }

    const exercises = rows.map((ex) => ({
      ...ex,
      inCurrentPlan: planNames.has(ex.name.toLowerCase()),
      youtubeUrl: youtubeTutorialUrl(ex.name),
      googleUrl: googleTutorialUrl(ex.name),
    }));

    const catalogCount = await getCatalogCount();
    return res.json({ success: true, exercises, catalogExerciseCount: catalogCount });
  } catch (err: any) {
    logger.error({ err: err.message }, "Exercise search failed");
    return res.status(500).json({ success: false, error: "Exercise search failed" });
  }
}

/**
 * GET /api/exercises/by-category
 */
export async function getExercisesByCategoryHandler(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { category = "strength", limit } = req.query as Record<string, string | undefined>;
  try {
    const rows = await getExercisesByCategory(category, limit ? parseInt(limit, 10) : 12);

    const plan = await workoutService.getCurrentWorkoutPlan(userId);
    const planNames = new Set(
      (plan?.exercises ?? []).map((ex) => (ex.exerciseName ?? "").toLowerCase()),
    );

    const exercises = rows.map((ex) => ({
      ...ex,
      inCurrentPlan: planNames.has(ex.name.toLowerCase()),
      youtubeUrl: youtubeTutorialUrl(ex.name),
      googleUrl: googleTutorialUrl(ex.name),
    }));

    return res.json({ success: true, exercises, category });
  } catch (err: any) {
    logger.error({ err: err.message }, "Category exercises failed");
    return res.status(500).json({ success: false, error: "Failed to load category exercises" });
  }
}

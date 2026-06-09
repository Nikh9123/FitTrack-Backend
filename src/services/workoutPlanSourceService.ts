import { db, inbodyReports, memberWorkoutPlans, userProfiles, userWorkoutPlans } from "../db";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export type WorkoutPlanSource = "trainer" | "ai" | "none";

export interface WorkoutPlanContext {
  planSource: WorkoutPlanSource;
  hasTrainerAssigned: boolean;
  canGenerateWithAi: boolean;
  hasInBodyReport: boolean;
  latestInBodyReportId: string | null;
  fitnessGoal: string | null;
  workoutOnboardingCompleted: boolean;
  trainerName: string | null;
}

export async function getWorkoutPlanContext(userId: string): Promise<WorkoutPlanContext> {
  const [profile] = await db
    .select({
      fitnessGoal: userProfiles.fitnessGoal,
      onboardingData: userProfiles.onboardingData,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const extra = (profile?.onboardingData as Record<string, unknown> | null) ?? {};

  const [trainerAssignment] = await db
    .select({
      id: memberWorkoutPlans.id,
      assignedBy: memberWorkoutPlans.assignedBy,
    })
    .from(memberWorkoutPlans)
    .where(
      and(
        eq(memberWorkoutPlans.userId, userId),
        eq(memberWorkoutPlans.status, "active"),
        isNotNull(memberWorkoutPlans.assignedBy),
      ),
    )
    .orderBy(desc(memberWorkoutPlans.assignedAt))
    .limit(1);

  const hasTrainerAssigned = Boolean(trainerAssignment?.assignedBy);

  const [aiPlan] = await db
    .select({ id: userWorkoutPlans.id, aiGenerated: userWorkoutPlans.aiGenerated })
    .from(userWorkoutPlans)
    .where(eq(userWorkoutPlans.userId, userId))
    .orderBy(desc(userWorkoutPlans.createdAt))
    .limit(1);

  const [latestReport] = await db
    .select({ id: inbodyReports.id })
    .from(inbodyReports)
    .where(eq(inbodyReports.userId, userId))
    .orderBy(desc(inbodyReports.createdAt))
    .limit(1);

  let planSource: WorkoutPlanSource = "none";
  if (hasTrainerAssigned) {
    planSource = "trainer";
  } else if (aiPlan || extra.workoutOnboardingCompleted) {
    planSource = "ai";
  }

  return {
    planSource,
    hasTrainerAssigned,
    canGenerateWithAi: !hasTrainerAssigned,
    hasInBodyReport: Boolean(latestReport),
    latestInBodyReportId: latestReport?.id ?? null,
    fitnessGoal: profile?.fitnessGoal ?? (extra.selectedGoal as string | null) ?? null,
    workoutOnboardingCompleted: Boolean(extra.workoutOnboardingCompleted),
    trainerName: hasTrainerAssigned ? "Your Trainer" : null,
  };
}

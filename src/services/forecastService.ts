import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db, exerciseLogs, exercises, inbodyReports, userWorkoutSessions } from "../db";
import { findUserById } from "../lib/auth";
import { getEnergyBalanceMetrics, getHistoryForDateRange } from "./historyService";
import { getJourneyProgress } from "./achievementService";
import { getPersonalRecords } from "./workoutService";

const KCAL_PER_KG_FAT = 7700;

export type ForecastConfidence = "high" | "medium" | "low";

export interface WeightForecastDetail {
  days: number;
  weightKg: number | null;
  lowKg: number | null;
  highKg: number | null;
  changeKg: number | null;
}

export interface StrengthForecastItem {
  exercise: string;
  current: string;
  predicted: string;
  weeks: number;
  trend: "up" | "stable" | "down";
}

export interface TransformationTimelineNode {
  horizon: "now" | "week4" | "week8" | "week12" | "week24";
  label: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  activityScore: number;
  journeyStage: string;
}

export type TimelineAlignment = "on_track" | "at_risk" | "off_track" | "need_data";

export interface TimelineInsightCard {
  id: string;
  icon: string;
  title: string;
  body: string;
  highlight?: string;
}

export interface TimelineInsightLiveMetrics {
  currentWeightKg: number | null;
  bmrDaily: number;
  estimatedTdee: number;
  avgCaloriesConsumed: number;
  avgActivityBurn: number;
  avgWorkoutBurn: number;
  avgTotalExpenditure: number;
  avgNetEnergyBalance: number;
  /** @deprecated use avgTotalExpenditure */
  avgCaloriesBurned: number;
  avgDailyDeficit: number;
  avgSteps: number;
  workoutsLast14Days: number;
  loggingConfidence: ForecastConfidence;
  projectedWeightChange12wKg: number | null;
  projectedBodyFatChange12wPct: number | null;
}

export interface TimelineInsight {
  goalKey: string;
  goalLabel: string;
  alignment: TimelineAlignment;
  alignmentLabel: string;
  headline: string;
  summary: string;
  cards: TimelineInsightCard[];
  liveMetrics: TimelineInsightLiveMetrics;
  actionItems: string[];
}

export interface CoachForecasts {
  weight30: number | null;
  weight60: number | null;
  weight90: number | null;
  weightDetails: WeightForecastDetail[];
  strength: StrengthForecastItem[];
  confidence: ForecastConfidence;
  avgDailyDeficit: number;
  disclaimer: string | null;
  transformationTimeline: TransformationTimelineNode[];
  timelineInsight: TimelineInsight | null;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function parseNum(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
}

function estimate1Rm(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

function loggingConfidence(mealDays: number, stepDays: number, totalDays: number): ForecastConfidence {
  const ratio = totalDays > 0 ? (mealDays + stepDays) / (totalDays * 2) : 0;
  if (ratio >= 0.65) return "high";
  if (ratio >= 0.35) return "medium";
  return "low";
}

function confidenceBandPct(confidence: ForecastConfidence): number {
  if (confidence === "high") return 0.1;
  if (confidence === "medium") return 0.15;
  return 0.25;
}

export async function computeAvgDailyDeficit(userId: string, lookbackDays = 14): Promise<number> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (lookbackDays - 1));
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const energy = await getEnergyBalanceMetrics(userId, start, end);
  return Math.max(0, energy.averages.netEnergyBalance);
}

export function computeWeightForecastDetails(
  currentKg: number | null,
  avgDailyDeficit: number,
  confidence: ForecastConfidence,
  goalWeightKg?: number | null,
): WeightForecastDetail[] {
  if (currentKg == null) return [];

  const band = confidenceBandPct(confidence);
  const horizons = [30, 60, 90];

  return horizons.map((days) => {
    const lossKg = (avgDailyDeficit * days) / KCAL_PER_KG_FAT;
    let projected = currentKg - lossKg;
    if (goalWeightKg != null && projected < goalWeightKg) {
      projected = goalWeightKg;
    }
    projected = round1(projected);
    const delta = round1(projected - currentKg);
    const spread = Math.abs(delta) * band || 0.5;

    return {
      days,
      weightKg: projected,
      lowKg: round1(projected - spread),
      highKg: round1(projected + spread),
      changeKg: delta,
    };
  });
}

export async function computeStrengthForecasts(userId: string, limit = 5): Promise<StrengthForecastItem[]> {
  const since = new Date();
  since.setDate(since.getDate() - 90);

  const logRows = await db
    .select({
      exerciseName: exercises.name,
      weight: exerciseLogs.weight,
      reps: exerciseLogs.reps,
      loggedAt: exerciseLogs.loggedAt,
    })
    .from(exerciseLogs)
    .innerJoin(userWorkoutSessions, eq(exerciseLogs.workoutSessionId, userWorkoutSessions.id))
    .innerJoin(exercises, eq(exerciseLogs.exerciseId, exercises.id))
    .where(and(eq(userWorkoutSessions.userId, userId), gte(exerciseLogs.loggedAt, since)))
    .orderBy(desc(exerciseLogs.loggedAt));

  const byExercise = new Map<
    string,
    Array<{ weight: number; reps: number; loggedAt: Date; score: number }>
  >();

  for (const row of logRows) {
    const weight = parseNum(row.weight);
    const reps = row.reps ?? 0;
    if (weight == null || weight <= 0 || reps <= 0) continue;
    const name = row.exerciseName;
    const score = estimate1Rm(weight, reps);
    const list = byExercise.get(name) ?? [];
    list.push({ weight, reps, loggedAt: new Date(row.loggedAt), score });
    byExercise.set(name, list);
  }

  const forecasts: StrengthForecastItem[] = [];

  for (const [exercise, sets] of byExercise.entries()) {
    if (sets.length === 0) continue;
    sets.sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime());
    const bestRecent = sets.reduce((best, s) => (s.score > best.score ? s : best), sets[0]);
    const currentWeight = bestRecent.weight;
    const predictedWeight = round1(Math.min(currentWeight * 1.05, currentWeight + 2.5));

    let trend: StrengthForecastItem["trend"] = "stable";
    if (sets.length >= 2) {
      const mid = Math.floor(sets.length / 2);
      const recentAvg = sets.slice(0, mid).reduce((s, x) => s + x.score, 0) / Math.max(mid, 1);
      const olderAvg = sets.slice(mid).reduce((s, x) => s + x.score, 0) / Math.max(sets.length - mid, 1);
      if (recentAvg > olderAvg * 1.03) trend = "up";
      else if (recentAvg < olderAvg * 0.97) trend = "down";
    }

    forecasts.push({
      exercise,
      current: `${currentWeight} kg × ${bestRecent.reps}`,
      predicted: `${predictedWeight} kg × ${bestRecent.reps}`,
      weeks: 2,
      trend,
    });
  }

  forecasts.sort((a, b) => {
    const trendScore = (t: StrengthForecastItem["trend"]) => (t === "up" ? 2 : t === "stable" ? 1 : 0);
    return trendScore(b.trend) - trendScore(a.trend);
  });

  if (forecasts.length >= limit) return forecasts.slice(0, limit);

  const prs = await getPersonalRecords(userId);
  for (const pr of prs) {
    if (forecasts.some((f) => f.exercise === pr.exerciseName)) continue;
    const w = parseNum(pr.maxWeight);
    const reps = pr.maxReps ?? 0;
    if (w == null || reps <= 0) continue;
    const predicted = round1(Math.min(w * 1.05, w + 2.5));
    forecasts.push({
      exercise: pr.exerciseName,
      current: `${w} kg × ${reps}`,
      predicted: `${predicted} kg × ${reps}`,
      weeks: 2,
      trend: "stable",
    });
    if (forecasts.length >= limit) break;
  }

  return forecasts;
}

type NormalizedGoal = "weight_loss" | "fat_loss" | "muscle_gain" | "maintenance";

function normalizeFitnessGoal(raw: string | null | undefined): NormalizedGoal {
  const g = (raw ?? "maintenance").toLowerCase().replace(/[\s-]+/g, "_");
  if (g.includes("muscle") || g.includes("gain") || g.includes("strength") || g.includes("bulk")) {
    return "muscle_gain";
  }
  if (g.includes("fat")) return "fat_loss";
  if (g.includes("loss") || g.includes("cut") || g.includes("slim")) return "weight_loss";
  return "maintenance";
}

function goalDisplayLabel(goal: NormalizedGoal): string {
  switch (goal) {
    case "weight_loss":
      return "Weight Loss";
    case "fat_loss":
      return "Fat Loss";
    case "muscle_gain":
      return "Muscle Gain";
    default:
      return "Maintenance & Fitness";
  }
}

function alignmentMeta(alignment: TimelineAlignment): { label: string; tone: string } {
  switch (alignment) {
    case "on_track":
      return { label: "On track for your goal", tone: "positive" };
    case "at_risk":
      return { label: "Progress may stall", tone: "caution" };
    case "off_track":
      return { label: "Habits working against your goal", tone: "negative" };
    default:
      return { label: "Need more data", tone: "neutral" };
  }
}

export function computeTimelineInsight(params: {
  fitnessGoal: string | null | undefined;
  history14: Awaited<ReturnType<typeof getHistoryForDateRange>>;
  energy: Awaited<ReturnType<typeof getEnergyBalanceMetrics>>;
  avgDailyDeficit: number;
  confidence: ForecastConfidence;
  currentWeightKg: number | null;
  bodyFatPct: number | null;
  workoutsLast14Days: number;
  transformationTimeline: TransformationTimelineNode[];
}): TimelineInsight {
  const {
    fitnessGoal,
    history14,
    energy,
    avgDailyDeficit,
    confidence,
    currentWeightKg,
    bodyFatPct,
    workoutsLast14Days,
    transformationTimeline,
  } = params;

  const goal = normalizeFitnessGoal(fitnessGoal);
  const goalLabel = goalDisplayLabel(goal);
  const avgSteps = history14.averages.steps;
  const avgConsumed = energy.averages.caloriesConsumed;
  const avgActivity = energy.averages.activityBurn;
  const avgWorkout = energy.averages.workoutBurn;
  const avgTotalOut = energy.averages.totalExpenditure;
  const netBalance = energy.averages.netEnergyBalance;
  const bmrDaily = energy.bmrDaily;
  const estimatedTdee = energy.estimatedTdee;
  const weightKg = currentWeightKg ?? energy.currentWeightKg;

  const nowNode = transformationTimeline.find((n) => n.horizon === "now");
  const week12Node = transformationTimeline.find((n) => n.horizon === "week12");
  const projectedWeightChange12wKg =
    currentWeightKg != null && week12Node?.weightKg != null
      ? round1(week12Node.weightKg - currentWeightKg)
      : null;
  const projectedBodyFatChange12wPct =
    bodyFatPct != null && week12Node?.bodyFatPct != null ? round1(week12Node.bodyFatPct - bodyFatPct) : null;

  const liveMetrics: TimelineInsightLiveMetrics = {
    currentWeightKg: weightKg,
    bmrDaily,
    estimatedTdee,
    avgCaloriesConsumed: avgConsumed,
    avgActivityBurn: avgActivity,
    avgWorkoutBurn: avgWorkout,
    avgTotalExpenditure: avgTotalOut,
    avgNetEnergyBalance: netBalance,
    avgCaloriesBurned: avgTotalOut,
    avgDailyDeficit: round1(avgDailyDeficit),
    avgSteps,
    workoutsLast14Days,
    loggingConfidence: confidence,
    projectedWeightChange12wKg,
    projectedBodyFatChange12wPct,
  };

  let alignment: TimelineAlignment = "need_data";
  let headline = "";
  let summary = "";
  const actionItems: string[] = [];

  const lowLogging = confidence === "low" || energy.daysWithMeals < 3;

  if (lowLogging) {
    alignment = "need_data";
    headline = "We need more logs to personalize this forecast";
    summary =
      "The timeline uses your last 14 days of meals, steps, and workouts. Log more consistently and this explanation will update instantly.";
    actionItems.push("Log meals on at least 5 days this week");
    actionItems.push("Track steps or sync activity daily");
    actionItems.push("Complete and log your workouts");
  } else if (goal === "weight_loss" || goal === "fat_loss") {
    if (netBalance <= 0) {
      alignment = "off_track";
      headline = "Your current intake is not supporting fat loss";
      summary = `At ${weightKg != null ? `${weightKg} kg` : "your current weight"}, you need a calorie deficit. You're averaging ${avgConsumed.toLocaleString()} kcal in vs ~${avgTotalOut.toLocaleString()} kcal out (BMR ${bmrDaily.toLocaleString()} + activity ${avgActivity.toLocaleString()} + workouts ${avgWorkout.toLocaleString()}). That ${netBalance < 0 ? "surplus" : "balance"} explains why the timeline shows little weight change.`;
      actionItems.push(`Target intake below ~${Math.max(1200, estimatedTdee - 400)} kcal (TDEE est. ${estimatedTdee.toLocaleString()} kcal)`);
      actionItems.push("Keep protein high (≈1.8g per kg body weight) to preserve muscle");
      actionItems.push("Log every meal so the coach can detect a real deficit");
    } else if (avgDailyDeficit < 200) {
      alignment = "at_risk";
      headline = "Deficit is too small for noticeable fat loss";
      summary = `A ~${Math.round(avgDailyDeficit)} kcal/day deficit may only yield ~${Math.abs(projectedWeightChange12wKg ?? 0)} kg over 12 weeks. For ${goalLabel.toLowerCase()}, most people need a sustained 300–500 kcal/day deficit.`;
      actionItems.push("Trim 200–300 kcal from daily intake or add a 30-min walk");
      actionItems.push("Prioritize whole foods and protein at each meal");
    } else {
      alignment = projectedWeightChange12wKg != null && projectedWeightChange12wKg < -0.3 ? "on_track" : "at_risk";
      headline =
        alignment === "on_track"
          ? "Your habits align with your fat-loss goal"
          : "Good deficit, but weight projection is modest";
      summary =
        alignment === "on_track"
          ? `Your ~${Math.round(avgDailyDeficit)} kcal/day deficit projects roughly ${Math.abs(projectedWeightChange12wKg ?? 0)} kg change by week 12. Body fat may shift if you stay consistent.`
          : `You have a deficit, but logged calories or activity may be incomplete. Keep logging to sharpen the projection.`;
      actionItems.push("Maintain your calorie deficit 5–6 days per week");
      actionItems.push("Hit 7k–10k steps on non-training days");
    }
  } else if (goal === "muscle_gain") {
    if (netBalance > 150) {
      alignment = "off_track";
      headline = "You're in a deficit — muscle gain will be hard";
      summary = `Muscle gain needs a slight surplus. Total expenditure (~${avgTotalOut.toLocaleString()} kcal incl. BMR ${bmrDaily.toLocaleString()}) exceeds intake by ~${Math.round(netBalance)} kcal/day on average.`;
      actionItems.push(`Eat ~${avgConsumed + 250}–${avgConsumed + 400} kcal/day with adequate protein`);
      actionItems.push("Progressive overload in 3–4 strength sessions per week");
      actionItems.push("Sleep 7–8 hours for recovery and growth");
    } else if (workoutsLast14Days < 3) {
      alignment = "at_risk";
      headline = "Training volume is low for muscle gain";
      summary = `Only ${workoutsLast14Days} workout${workoutsLast14Days === 1 ? "" : "s"} logged in 14 days. The score on the timeline may rise from consistency, but muscle needs regular resistance training.`;
      actionItems.push("Schedule at least 3–4 strength sessions per week");
      actionItems.push("Track sets, reps, and weight for key lifts");
      actionItems.push("Target 1.8–2.2g protein per kg body weight daily");
    } else {
      alignment = "on_track";
      headline = "Training and nutrition support muscle building";
      summary = `With ${workoutsLast14Days} sessions in 14 days and balanced intake, your timeline reflects steady progress. Strength forecasts show where lifts may improve next.`;
      actionItems.push("Add weight or reps when you hit the top of your rep range");
      actionItems.push("Keep protein consistent even on rest days");
    }
  } else {
    const imbalance = Math.abs(netBalance);
    if (imbalance > 400) {
      alignment = "off_track";
      headline = netBalance > 0 ? "Large deficit for a maintenance goal" : "Large surplus for a maintenance goal";
      summary =
        netBalance > 0
          ? `You're averaging a ${Math.round(netBalance)} kcal/day deficit vs TDEE ~${estimatedTdee.toLocaleString()} kcal. Maintenance means staying near energy balance.`
          : `You're eating ~${Math.round(Math.abs(netBalance))} kcal above total expenditure (~${avgTotalOut.toLocaleString()} kcal incl. BMR). Expect gradual weight gain unless intentional.`;
      actionItems.push("Adjust calories toward your maintenance target");
    } else if (avgSteps < 4000 && workoutsLast14Days < 2) {
      alignment = "at_risk";
      headline = "Low activity may limit fitness gains";
      summary = "For general fitness, the timeline boosts your activity score if you stay consistent — but steps and workouts are currently light.";
      actionItems.push("Aim for 6k+ steps most days");
      actionItems.push("Add 2–3 workouts per week (mix cardio and strength)");
    } else {
      alignment = "on_track";
      headline = "Your habits support steady maintenance";
      summary = `Calories and activity are relatively balanced. The timeline shows modest score improvements from consistency rather than large body changes.`;
      actionItems.push("Keep logging to catch drift early");
      actionItems.push("Maintain sleep and hydration habits");
    }
  }

  const { label: alignmentLabel } = alignmentMeta(alignment);

  const scoreNow = nowNode?.activityScore ?? 0;
  const score12 = week12Node?.activityScore ?? scoreNow;

  const cards: TimelineInsightCard[] = [
    {
      id: "goal",
      icon: "flag",
      title: `Your goal: ${goalLabel}`,
      body:
        goal === "weight_loss" || goal === "fat_loss"
          ? "Projections use your weight, BMR (metabolic rate), logged meals, step/activity burn, workout calories, and goal. Weight change follows your net calorie balance over time."
          : goal === "muscle_gain"
            ? "Projections combine your weight, BMR, intake, training volume, and strength logs to estimate if you're eating enough to build muscle."
            : "Projections use BMR, activity, workouts, and intake to see if you're maintaining balance while improving consistency.",
    },
    {
      id: "habits",
      icon: "analytics",
      title: "What we see right now (last 14 days)",
      body: `Weight ${weightKg != null ? `${weightKg} kg` : "—"} · Intake ${avgConsumed.toLocaleString()} kcal · Total out ${avgTotalOut.toLocaleString()} kcal (BMR ${bmrDaily.toLocaleString()} + activity ${avgActivity.toLocaleString()} + workouts ${avgWorkout.toLocaleString()}) · ${avgSteps.toLocaleString()} steps/day · ${workoutsLast14Days} workouts.`,
      highlight:
        netBalance > 0
          ? `~${Math.round(netBalance)} kcal/day deficit · TDEE est. ${estimatedTdee.toLocaleString()} kcal`
          : netBalance < 0
            ? `~${Math.round(Math.abs(netBalance))} kcal/day surplus · TDEE est. ${estimatedTdee.toLocaleString()} kcal`
            : `Near energy balance · TDEE est. ${estimatedTdee.toLocaleString()} kcal`,
    },
    {
      id: "timeline",
      icon: "git-branch",
      title: "How to read the timeline",
      body:
        projectedWeightChange12wKg != null && projectedWeightChange12wKg !== 0
          ? `Weight may shift ~${projectedWeightChange12wKg > 0 ? "+" : ""}${projectedWeightChange12wKg} kg by week 12. Activity score may rise from ${scoreNow} → ${score12} with consistent logging — that reflects engagement, not automatic fat loss.`
          : `Weight and body fat stay flat in the projection because your recent data shows no sustained calorie gap. Activity score may still rise (${scoreNow} → ${score12}) if you log consistently.`,
      highlight:
        bodyFatPct != null && projectedBodyFatChange12wPct != null && projectedBodyFatChange12wPct !== 0
          ? `Body fat projection: ${projectedBodyFatChange12wPct > 0 ? "+" : ""}${projectedBodyFatChange12wPct}% by week 12`
          : undefined,
    },
    {
      id: "verdict",
      icon: alignment === "on_track" ? "checkmark-circle" : alignment === "need_data" ? "help-circle" : "warning",
      title: alignmentLabel,
      body: summary,
      highlight: headline,
    },
  ];

  return {
    goalKey: goal,
    goalLabel,
    alignment,
    alignmentLabel,
    headline,
    summary,
    cards,
    liveMetrics,
    actionItems,
  };
}

export async function computeTransformationTimeline(
  userId: string,
  currentWeightKg: number | null,
  currentScore: number,
  avgDailyDeficit: number,
  goalWeightKg?: number | null,
): Promise<TransformationTimelineNode[]> {
  const journey = await getJourneyProgress(userId);
  const stageName = journey.currentStage.name;

  const [inbody] = await db
    .select({ extractedMetrics: inbodyReports.extractedMetrics })
    .from(inbodyReports)
    .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
    .orderBy(desc(inbodyReports.createdAt))
    .limit(1);

  const m = (inbody?.extractedMetrics ?? {}) as Record<string, string>;
  const bodyFat = parseNum(m.bodyFat);

  const horizons: Array<{ horizon: TransformationTimelineNode["horizon"]; label: string; weeks: number }> = [
    { horizon: "now", label: "Today", weeks: 0 },
    { horizon: "week4", label: "Week 4", weeks: 4 },
    { horizon: "week8", label: "Week 8", weeks: 8 },
    { horizon: "week12", label: "Week 12", weeks: 12 },
    { horizon: "week24", label: "Week 24", weeks: 24 },
  ];

  return horizons.map(({ horizon, label, weeks }) => {
    let weight = currentWeightKg;
    if (weight != null && weeks > 0) {
      const loss = (avgDailyDeficit * weeks * 7) / KCAL_PER_KG_FAT;
      weight = round1(weight - loss);
      if (goalWeightKg != null) weight = Math.max(weight, goalWeightKg);
    }

    let bf = bodyFat;
    if (bf != null && weeks > 0 && avgDailyDeficit > 200) {
      bf = round1(clamp(bf - weeks * 0.5, 5, bf));
    }

    const scoreBoost = Math.min(weeks * 1.5, 15);
    const activityScore = clamp(Math.round(currentScore + scoreBoost), 0, 100);

    return {
      horizon,
      label,
      weightKg: weight,
      bodyFatPct: bf,
      activityScore,
      journeyStage: stageName,
    };
  });
}

export async function buildCoachForecasts(userId: string, currentWeightKg: number | null): Promise<CoachForecasts> {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 13);
  start.setHours(0, 0, 0, 0);

  const [history14, avgDailyDeficit, strength, userRow, journey, workoutRows, inbodyRow, energy14] = await Promise.all([
    getHistoryForDateRange(userId, start, end),
    computeAvgDailyDeficit(userId, 14),
    computeStrengthForecasts(userId),
    findUserById(userId),
    getJourneyProgress(userId),
    db
      .select({ id: userWorkoutSessions.id })
      .from(userWorkoutSessions)
      .where(
        and(
          eq(userWorkoutSessions.userId, userId),
          sql`${userWorkoutSessions.completedAt} IS NOT NULL`,
          gte(userWorkoutSessions.completedAt, start),
          lte(userWorkoutSessions.completedAt, end),
        ),
      ),
    db
      .select({ extractedMetrics: inbodyReports.extractedMetrics })
      .from(inbodyReports)
      .where(and(eq(inbodyReports.userId, userId), eq(inbodyReports.status, "done")))
      .orderBy(desc(inbodyReports.createdAt))
      .limit(1),
    getEnergyBalanceMetrics(userId, start, end),
  ]);

  const confidence = loggingConfidence(
    history14.totals.daysWithMeals,
    history14.totals.daysWithSteps,
    history14.days,
  );

  const profileWeight = parseNum(userRow?.profile?.weightKg);
  const currentKg = currentWeightKg ?? profileWeight;

  const goalWeight =
    userRow?.profile?.fitnessGoal === "weight_loss" || userRow?.profile?.fitnessGoal === "fat_loss"
      ? currentKg != null
        ? round1(currentKg - 5)
        : null
      : null;

  const weightDetails = computeWeightForecastDetails(currentKg, avgDailyDeficit, confidence, goalWeight);
  const w30 = weightDetails.find((w) => w.days === 30)?.weightKg ?? null;
  const w60 = weightDetails.find((w) => w.days === 60)?.weightKg ?? null;
  const w90 = weightDetails.find((w) => w.days === 90)?.weightKg ?? null;

  const trainerScore = journey.totalPoints > 0 ? clamp(40 + Math.round(journey.totalPoints / 50), 30, 95) : 45;
  const transformationTimeline = await computeTransformationTimeline(
    userId,
    currentKg,
    trainerScore,
    avgDailyDeficit,
    goalWeight,
  );

  const inbodyMetrics = (inbodyRow[0]?.extractedMetrics ?? {}) as Record<string, string>;
  const bodyFatPct = parseNum(inbodyMetrics.bodyFat);

  const timelineInsight = computeTimelineInsight({
    fitnessGoal: userRow?.profile?.fitnessGoal ?? null,
    history14,
    energy: energy14,
    avgDailyDeficit,
    confidence,
    currentWeightKg: currentKg,
    bodyFatPct,
    workoutsLast14Days: workoutRows.length,
    transformationTimeline,
  });

  let disclaimer: string | null = null;
  if (confidence === "low") {
    disclaimer = "Log meals and steps more consistently to improve forecast accuracy.";
  } else if (avgDailyDeficit <= 0) {
    disclaimer = "No calorie deficit detected — weight projections assume current habits continue.";
  }

  return {
    weight30: w30,
    weight60: w60,
    weight90: w90,
    weightDetails,
    strength,
    confidence,
    avgDailyDeficit: round1(avgDailyDeficit),
    disclaimer,
    transformationTimeline,
    timelineInsight,
  };
}

export async function buildStrengthTrends(userId: string): Promise<Array<{ exercise: string; trend: string }>> {
  const strength = await computeStrengthForecasts(userId, 8);
  return strength.map((s) => ({
    exercise: s.exercise,
    trend: s.trend === "up" ? "improving" : s.trend === "down" ? "declining" : "stable",
  }));
}

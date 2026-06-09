import type { GoalEvaluation, NextWeekGoals } from "./goalRecommendationEngine";
import type { UnlockedAchievement } from "./achievementService";
import type {
  CoachForecasts,
  StrengthForecastItem,
  TransformationTimelineNode,
  WeightForecastDetail,
} from "./forecastService";

export type { CoachForecasts, StrengthForecastItem, TransformationTimelineNode, WeightForecastDetail };

export interface DailyActivityDay {
  date: string;
  dayLabel: string;
  steps: number;
  caloriesBurned: number;
  caloriesConsumed: number;
  waterGlasses: number;
  sleepHours: number;
  weightKg: number | null;
  workoutCompleted: boolean;
  activitiesLogged: string[];
}

export interface DataSourceConsidered {
  id: string;
  label: string;
  metrics: string[];
  description: string;
}

export interface CoachReviewContext {
  period: { start: string; end: string; label: "weekly" | "monthly"; weekKey: string };
  profile: {
    name: string;
    age: number | null;
    gender: string | null;
    heightCm: number | null;
    weightKg: number | null;
    fitnessGoal: string | null;
  };
  summary: {
    overallScore: number;
    weight: { start: number | null; end: number | null; change: number };
    steps: number;
    caloriesBurned: number;
    caloriesConsumed: number;
    workouts: { completed: number; planned: number; consistencyPct: number };
    waterGoalDays: number;
    sleepGoalDays: number;
    proteinAvgG: number;
  };
  trends: {
    weight: "up" | "down" | "stable";
    fatLoss: number | null;
    muscle: number | null;
    strength: Array<{ exercise: string; trend: string }>;
    recovery: number;
    consistency: number;
  };
  goal: GoalEvaluation;
  nextWeekGoals: NextWeekGoals;
  achievements: { unlockedThisPeriod: UnlockedAchievement[]; totalPoints: number };
  drivers: { positive: string[]; negative: string[] };
  forecasts: CoachForecasts;
}

export interface WeeklyReviewResponse {
  weekKey: string;
  weekLabel: string;
  overallScore: number;
  summary: {
    weight: { current: number | null; change: number };
    steps: number;
    caloriesBurned: number;
    caloriesConsumed: number;
    workouts: string;
    waterGoalDays: string;
    sleepGoalDays: string;
    consistency: number;
    proteinAvgG: number;
  };
  aiSummary: string;
  progressAnalysis: {
    weight: string;
    activity: string;
    nutrition: string;
    recovery: string;
  };
  goalEvaluation: GoalEvaluation;
  nextWeekGoals: NextWeekGoals;
  drivers: { helped: string[]; holdingBack: string[] };
  coachInsights: string[];
  forecasts: CoachReviewContext["forecasts"];
  achievementsUnlocked: UnlockedAchievement[];
  generatedAt: string;
  cached: boolean;
  narrativeSource: "groq" | "fallback";
  nextWeekFocus: string;
  dailyBreakdown: DailyActivityDay[];
  dataSourcesConsidered: DataSourceConsidered[];
  activeDaysCount: number;
  transformationTimeline: TransformationTimelineNode[];
  saved: boolean;
  reportId: string | null;
  savedAt: string | null;
}

export interface MonthlyReviewResponse {
  monthKey: string;
  monthLabel: string;
  overallScore: number;
  aiSummary: string;
  summary: {
    totalWorkouts: number;
    totalSteps: number;
    totalVolumeKg: number | null;
    weightChange: number;
    bestWeekScore: number | null;
    currentWeightKg: number | null;
  };
  progressAnalysis: {
    weight: string;
    activity: string;
    nutrition: string;
    recovery: string;
  };
  coachInsights: string[];
  goalEvaluation: GoalEvaluation;
  nextMonthGoals: NextWeekGoals;
  achievementsUnlocked: UnlockedAchievement[];
  forecasts: CoachForecasts;
  transformationTimeline: TransformationTimelineNode[];
  personalRecords: Array<{ exercise: string; current: string; predicted: string; weeks: number }>;
  generatedAt: string;
  cached: boolean;
  narrativeSource: "groq" | "fallback";
  nextMonthFocus: string;
  saved: boolean;
  reportId: string | null;
  savedAt: string | null;
}

export interface SavedCoachReportSummary {
  reportId: string;
  type: "coach_weekly_review" | "coach_monthly_review";
  periodKey: string;
  periodLabel: string;
  overallScore: number;
  savedAt: string;
}

export type DailyDigestCategory = "nutrition" | "activity" | "recovery" | "consistency" | "general";

export interface DailyDigestYesterday {
  dateLabel: string;
  steps: number;
  caloriesConsumed: number;
  caloriesBurned: number;
  workoutCompleted: boolean;
  sleepHours: number;
  waterGlasses: number;
}

export interface DailyDigestResponse {
  dateKey: string;
  dateLabel: string;
  tip: string;
  focusAction: string;
  category: DailyDigestCategory;
  yesterday: DailyDigestYesterday;
  streakDays: number;
  fitnessGoal: string | null;
  generatedAt: string;
  cached: boolean;
  narrativeSource: "groq" | "fallback";
  saved: boolean;
  reportId: string | null;
  savedAt: string | null;
}

export interface DailyDigestContext {
  dateKey: string;
  dateLabel: string;
  fitnessGoal: string | null;
  calorieGoal: number | null;
  streakDays: number;
  yesterday: DailyDigestYesterday;
  weekScore: number | null;
}

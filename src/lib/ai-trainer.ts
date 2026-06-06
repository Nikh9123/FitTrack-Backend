import Groq from "groq-sdk";
import type { TrainerContextPayload } from "./ai-trainer-context";
import { logger } from "./logger";

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const CHAT_MODEL = process.env.AI_TRAINER_MODEL ?? process.env.GROQ_MODEL ?? "llama-3.1-8b-instant";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are FitTrack AI Coach — a professional, motivational fitness coach embedded in the FitTrack app.

Rules:
- Use ONLY numbers and facts from the user context JSON. Never invent metrics.
- Cite specific data when giving advice (e.g. "Your 12-day streak", "7-day avg sleep of 6.2h").
- Be concise: 2-4 short paragraphs max. Use bullet points for action items when helpful.
- Tone: supportive, direct, evidence-based — like a great personal trainer.
- If data is missing, encourage logging (meals, water, check-ins, workouts) without guessing values.
- Do not diagnose medical conditions. Suggest seeing a professional for injuries or health concerns.`;

export async function generateTrainerReply(
  context: TrainerContextPayload,
  history: ChatTurn[],
  userMessage: string,
): Promise<{ content: string; source: "groq" | "fallback" }> {
  if (!groq) {
    return { content: buildFallbackReply(context, userMessage), source: "fallback" };
  }

  const contextBlock = JSON.stringify(context, null, 2);
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `User context (ground truth — cite these numbers only):\n${contextBlock}`,
    },
    ...history.slice(-12).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ];

  try {
    const result = await groq.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      temperature: 0.55,
      max_tokens: 700,
    });
    const content = result.choices[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty Groq response");
    return { content, source: "groq" };
  } catch (err: any) {
    logger.warn({ err: err.message }, "AI trainer Groq reply failed");
    return { content: buildFallbackReply(context, userMessage), source: "fallback" };
  }
}

function buildFallbackReply(context: TrainerContextPayload, userMessage: string): string {
  const lower = userMessage.toLowerCase();
  const parts: string[] = [];

  if (lower.includes("sleep") || lower.includes("recover")) {
    parts.push(
      context.sleepAverage.hours7d > 0
        ? `Your 7-day sleep average is ${context.sleepAverage.hours7d}h across ${context.sleepAverage.daysLogged} logged days. Aim for 7–8h consistently.`
        : "Log daily check-ins with sleep hours so I can give you recovery advice.",
    );
  }

  if (lower.includes("weight") || lower.includes("fat")) {
    const latest = context.weightTrend[context.weightTrend.length - 1];
    parts.push(
      latest
        ? `Your latest logged weight is ${latest.kg} kg (${latest.date}). Keep weekly weigh-ins at the same time of day.`
        : "Start logging weight on Home or Progress to track your trend.",
    );
  }

  if (lower.includes("workout") || lower.includes("train") || lower.includes("exercise")) {
    parts.push(
      context.workoutStreak > 0
        ? `You're on a ${context.workoutStreak}-day workout streak with ${context.consistencyScore}% consistency this month — strong work!`
        : "Complete a workout session today to start building your streak.",
    );
  }

  if (lower.includes("calorie") || lower.includes("eat") || lower.includes("diet") || lower.includes("food")) {
    parts.push(
      context.calorieAverage.kcal7d > 0
        ? `Your 7-day average intake is ~${Math.round(context.calorieAverage.kcal7d)} kcal/day across ${context.calorieAverage.daysWithMeals} days with meals logged.`
        : "Log meals in the Diet tab so we can balance your nutrition.",
    );
  }

  if (parts.length === 0) {
    parts.push(
      `Hi ${context.profile.name}! Fitness score: ${context.profile.fitnessScore}/100.`,
      context.workoutStreak > 0
        ? `${context.workoutStreak}-day workout streak active.`
        : "No active workout streak — let's change that today.",
      context.stepsAverage.steps7d > 0
        ? `7-day step average: ${Math.round(context.stepsAverage.steps7d).toLocaleString()}.`
        : "Sync steps from your phone to track daily activity.",
      "Ask me about workouts, nutrition, sleep, or your progress — I'll use your real data.",
    );
  }

  return parts.join("\n\n");
}

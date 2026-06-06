import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  aiPlanRequests,
  aiPlanResponses,
  chatMessages,
  chatParticipants,
  chatThreads,
  db,
} from "../db";
import { buildTrainerContext } from "../lib/ai-trainer-context";
import { generateTrainerReply, type ChatTurn } from "../lib/ai-trainer";
import { getAiCoachUserId, isAiCoachUser } from "../lib/ai-trainer-user";

const DAILY_LIMIT = parseInt(process.env.AI_TRAINER_DAILY_MESSAGE_LIMIT ?? "50", 10);

export interface ChatMessageDto {
  id: string;
  threadId: string;
  senderId: string;
  role: "user" | "assistant";
  content: string;
  messageType: string;
  createdAt: string;
}

export interface ChatThreadDto {
  id: string;
  subject: string | null;
  threadType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: ChatMessageDto | null;
}

async function assertParticipant(userId: string, threadId: string) {
  const [row] = await db
    .select({ id: chatParticipants.id })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.threadId, threadId), eq(chatParticipants.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Thread not found");
}

function toMessageDto(
  msg: typeof chatMessages.$inferSelect,
  aiCoachUserId: string,
): ChatMessageDto {
  return {
    id: msg.id,
    threadId: msg.threadId,
    senderId: msg.senderId,
    role: isAiCoachUser(msg.senderId, aiCoachUserId) ? "assistant" : "user",
    content: msg.content ?? "",
    messageType: msg.messageType,
    createdAt: msg.createdAt.toISOString(),
  };
}

export async function listThreads(userId: string): Promise<ChatThreadDto[]> {
  const aiCoachUserId = await getAiCoachUserId();

  const participantRows = await db
    .select({ threadId: chatParticipants.threadId })
    .from(chatParticipants)
    .where(eq(chatParticipants.userId, userId));

  const threadIds = participantRows.map((r) => r.threadId);
  if (threadIds.length === 0) return [];

  const threads = await db
    .select()
    .from(chatThreads)
    .where(and(inArray(chatThreads.id, threadIds), eq(chatThreads.threadType, "system_chat")))
    .orderBy(desc(chatThreads.updatedAt));

  const result: ChatThreadDto[] = [];
  for (const thread of threads) {
    const [lastMsg] = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.threadId, thread.id))
      .orderBy(desc(chatMessages.createdAt))
      .limit(1);

    result.push({
      id: thread.id,
      subject: thread.subject,
      threadType: thread.threadType,
      status: thread.status,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      lastMessage: lastMsg ? toMessageDto(lastMsg, aiCoachUserId) : null,
    });
  }

  return result;
}

export async function createThread(userId: string, subject?: string): Promise<ChatThreadDto> {
  const [thread] = await db
    .insert(chatThreads)
    .values({
      createdBy: userId,
      threadType: "system_chat",
      subject: subject?.trim() || "AI Fitness Coach",
      status: "open",
    })
    .returning();

  await db.insert(chatParticipants).values({ threadId: thread.id, userId });

  const aiCoachUserId = await getAiCoachUserId();
  const welcome = await db
    .insert(chatMessages)
    .values({
      threadId: thread.id,
      senderId: aiCoachUserId,
      messageType: "text",
      content: `Hi! I'm your FitTrack AI Coach. I can see your workouts, nutrition, sleep, and progress data. Ask me anything about training, recovery, or reaching your goals.`,
      status: "sent",
    })
    .returning();

  return {
    id: thread.id,
    subject: thread.subject,
    threadType: thread.threadType,
    status: thread.status,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    lastMessage: toMessageDto(welcome[0], aiCoachUserId),
  };
}

export async function getOrCreateDefaultThread(userId: string): Promise<ChatThreadDto> {
  const existing = await listThreads(userId);
  const open = existing.find((t) => t.status === "open");
  if (open) return open;
  return createThread(userId);
}

export async function listMessages(
  userId: string,
  threadId: string,
  limit = 50,
): Promise<ChatMessageDto[]> {
  await assertParticipant(userId, threadId);
  const aiCoachUserId = await getAiCoachUserId();

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);

  return rows.reverse().map((m) => toMessageDto(m, aiCoachUserId));
}

async function checkRateLimit(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(aiPlanRequests)
    .where(
      and(
        eq(aiPlanRequests.userId, userId),
        gte(aiPlanRequests.createdAt, startOfDay),
        sql`${aiPlanRequests.inputPayload}->>'kind' = 'trainer_chat'`,
      ),
    );

  if ((row?.count ?? 0) >= DAILY_LIMIT) {
    throw new Error(`Daily AI coach message limit reached (${DAILY_LIMIT}). Try again tomorrow.`);
  }
}

async function auditAiRequest(userId: string, prompt: string, response: string, source: string) {
  const [request] = await db
    .insert(aiPlanRequests)
    .values({
      userId,
      requestType: "recommendation",
      prompt: prompt.slice(0, 2000),
      inputPayload: { kind: "trainer_chat", source },
      status: "completed",
      completedAt: new Date(),
    })
    .returning();

  await db.insert(aiPlanResponses).values({
    requestId: request.id,
    responsePayload: { content: response.slice(0, 4000), source },
  });
}

export async function sendMessageAndReply(
  userId: string,
  threadId: string,
  content: string,
): Promise<{ userMessage: ChatMessageDto; assistantMessage: ChatMessageDto; source: string }> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Message cannot be empty");

  await assertParticipant(userId, threadId);
  await checkRateLimit(userId);

  const aiCoachUserId = await getAiCoachUserId();

  const [userMsg] = await db
    .insert(chatMessages)
    .values({
      threadId,
      senderId: userId,
      messageType: "text",
      content: trimmed,
      status: "sent",
    })
    .returning();

  const priorMessages = await listMessages(userId, threadId, 20);
  const history: ChatTurn[] = priorMessages
    .filter((m) => m.id !== userMsg.id)
    .map((m) => ({ role: m.role, content: m.content }));

  const context = await buildTrainerContext(userId);
  const { content: replyContent, source } = await generateTrainerReply(context, history, trimmed);

  const [assistantMsg] = await db
    .insert(chatMessages)
    .values({
      threadId,
      senderId: aiCoachUserId,
      messageType: "text",
      content: replyContent,
      status: "sent",
    })
    .returning();

  await db
    .update(chatThreads)
    .set({ updatedAt: new Date() })
    .where(eq(chatThreads.id, threadId));

  await auditAiRequest(userId, trimmed, replyContent, source);

  return {
    userMessage: toMessageDto(userMsg, aiCoachUserId),
    assistantMessage: toMessageDto(assistantMsg, aiCoachUserId),
    source,
  };
}

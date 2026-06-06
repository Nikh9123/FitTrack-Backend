import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/auth";
import { logger } from "../lib/logger";
import * as chatService from "../services/chatService";

export async function listThreads(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const threads = await chatService.listThreads(userId);
    return res.json({ success: true, threads });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to list chat threads");
    return res.status(500).json({ success: false, error: "Failed to list threads" });
  }
}

export async function createThread(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { subject } = req.body ?? {};
  try {
    const thread = await chatService.createThread(userId, subject);
    return res.status(201).json({ success: true, thread });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to create chat thread");
    return res.status(500).json({ success: false, error: "Failed to create thread" });
  }
}

export async function getDefaultThread(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  try {
    const thread = await chatService.getOrCreateDefaultThread(userId);
    return res.json({ success: true, thread });
  } catch (err: any) {
    logger.error({ err: err.message, userId }, "Failed to get default chat thread");
    return res.status(500).json({ success: false, error: "Failed to get coach thread" });
  }
}

export async function listMessages(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const threadId = String(req.params.threadId);
  const limit = parseInt(req.query.limit as string) || 50;
  try {
    const messages = await chatService.listMessages(userId, threadId, limit);
    return res.json({ success: true, messages });
  } catch (err: any) {
    const status = err.message === "Thread not found" ? 404 : 500;
    return res.status(status).json({ success: false, error: err.message || "Failed to list messages" });
  }
}

export async function sendMessage(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const threadId = String(req.params.threadId);
  const { content } = req.body ?? {};
  try {
    const result = await chatService.sendMessageAndReply(userId, threadId, content);
    return res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    const msg = err.message || "Failed to send message";
    const status =
      msg.includes("limit reached") ? 429 :
      msg.includes("empty") ? 400 :
      msg.includes("not found") ? 404 :
      500;
    logger.warn({ err: msg, userId, threadId }, "Chat send failed");
    return res.status(status).json({ success: false, error: msg });
  }
}

export async function aiReply(req: AuthenticatedRequest, res: Response) {
  const userId = req.auth!.sub;
  const { threadId, content } = req.body ?? {};
  if (!threadId || !content) {
    return res.status(400).json({ success: false, error: "threadId and content are required" });
  }
  try {
    const result = await chatService.sendMessageAndReply(userId, threadId, content);
    return res.status(201).json({ success: true, ...result });
  } catch (err: any) {
    const msg = err.message || "Failed to get AI reply";
    const status = msg.includes("limit reached") ? 429 : msg.includes("not found") ? 404 : 500;
    return res.status(status).json({ success: false, error: msg });
  }
}

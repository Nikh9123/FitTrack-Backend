import { Router } from "express";
import { requireAuth } from "../lib/auth";
import {
  aiReply,
  createThread,
  getDefaultThread,
  listMessages,
  listThreads,
  sendMessage,
} from "./chat.controller";

const router = Router();

router.get("/chat/threads", requireAuth, listThreads);
router.post("/chat/threads", requireAuth, createThread);
router.get("/chat/threads/default", requireAuth, getDefaultThread);
router.get("/chat/threads/:threadId/messages", requireAuth, listMessages);
router.post("/chat/threads/:threadId/messages", requireAuth, sendMessage);
router.post("/chat/ai-reply", requireAuth, aiReply);

export default router;

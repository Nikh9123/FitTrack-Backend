import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import multer from "multer";
import { db, membershipUpgradeRequests, userProfiles } from "../db";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { uploadToStorage } from "../lib/inbody-ocr";
import { logger } from "../lib/logger";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

router.get("/membership/upgrade-status", requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.auth!.sub;

  const [profile] = await db
    .select({ membershipTier: userProfiles.membershipTier })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const [latest] = await db
    .select()
    .from(membershipUpgradeRequests)
    .where(eq(membershipUpgradeRequests.userId, userId))
    .orderBy(desc(membershipUpgradeRequests.submittedAt))
    .limit(1);

  return res.json({
    membershipTier: profile?.membershipTier ?? "free",
    latestRequest: latest
      ? {
          id: latest.id,
          status: latest.status,
          transactionId: latest.transactionId,
          submittedAt: latest.submittedAt,
        }
      : null,
  });
});

router.post(
  "/membership/upgrade-request",
  requireAuth,
  upload.single("proof"),
  async (req: AuthenticatedRequest, res) => {
    const userId = req.auth!.sub;
    const transactionId =
      typeof req.body?.transactionId === "string" ? req.body.transactionId.trim() : "";

    if (!transactionId && !req.file) {
      return res.status(400).json({ error: "Provide a transaction ID or payment screenshot" });
    }

    let proofUrl: string | null = null;
    if (req.file) {
      try {
        proofUrl = await uploadToStorage(
          req.file.buffer,
          req.file.mimetype ?? "image/jpeg",
          userId,
          "membership-proof",
        );
      } catch (err) {
        logger.warn({ err, userId }, "Membership proof upload failed — continuing without stored file");
      }
    }

    const [created] = await db
      .insert(membershipUpgradeRequests)
      .values({
        userId,
        status: "pending",
        transactionId: transactionId || null,
        proofUrl,
      })
      .returning();

    await db
      .update(userProfiles)
      .set({ membershipTier: "pending", updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId));

    return res.status(201).json({
      request: {
        id: created.id,
        status: created.status,
        transactionId: created.transactionId,
        submittedAt: created.submittedAt,
      },
      message:
        "Payment under verification — membership will be updated within 24 hours post verification.",
    });
  },
);

export default router;

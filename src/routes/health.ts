import { Router, type IRouter } from "express";
import { z } from "zod";

const HealthCheckResponse = z.object({
  status: z.string(),
  timestamp: z.string(),
});

const router: IRouter = Router();

router.get("/health", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
  res.json(data);
});

export default router;
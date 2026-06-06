import { Router, type IRouter } from "express";
import { fetchLiveMotivationQuote } from "../services/motivationQuoteService";

const router: IRouter = Router();

/** Public — live motivation quote from external APIs */
router.get("/motivation/quote", async (_req, res) => {
  try {
    const quote = await fetchLiveMotivationQuote();
    res.json(quote);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch quote";
    res.status(503).json({ error: message });
  }
});

export default router;

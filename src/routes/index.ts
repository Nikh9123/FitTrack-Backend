import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import inbodyRouter from "./inbody";
import workoutOnboardingRouter from "./workout-onboarding";
import progressRouter from "./progress";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inbodyRouter);
router.use(workoutOnboardingRouter);
router.use(progressRouter);

export default router;

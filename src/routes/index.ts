import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import inbodyRouter from "./inbody";
import workoutOnboardingRouter from "./workout-onboarding";
import progressRouter from "./progress";
import workoutsRouter from "./workouts";
import dietRouter from "./diet";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inbodyRouter);
router.use(workoutOnboardingRouter);
router.use(progressRouter);
router.use(workoutsRouter);
router.use(dietRouter);

export default router;

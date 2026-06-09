import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import inbodyRouter from "./inbody";
import workoutOnboardingRouter from "./workout-onboarding";
import progressRouter from "./progress";
import workoutsRouter from "./workouts";
import dietRouter from "./diet";
import motivationRouter from "./motivation";
import chatRouter from "./chat";
import achievementsRouter from "./achievements";
import coachRouter from "./coach";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inbodyRouter);
router.use(workoutOnboardingRouter);
router.use(progressRouter);
router.use(workoutsRouter);
router.use(dietRouter);
router.use(motivationRouter);
router.use(chatRouter);
router.use(achievementsRouter);
router.use(coachRouter);

export default router;

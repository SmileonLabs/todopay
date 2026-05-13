import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import memberAuthRouter from "./member-auth";
import usersRouter from "./users";
import membersRouter from "./members";
import virtualAccountsRouter from "./virtual_accounts";
import withdrawalsRouter from "./withdrawals";
import transactionsRouter from "./transactions";
import balancesRouter from "./balances";
import feesRouter from "./fees";
import statisticsRouter from "./statistics";
import noticesRouter from "./notices";
import otpRouter from "./otp";
import purgeRouter from "./purge";

const router: IRouter = Router();

router.use(purgeRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(memberAuthRouter);
router.use(usersRouter);
router.use(membersRouter);
router.use(virtualAccountsRouter);
router.use(withdrawalsRouter);
router.use(transactionsRouter);
router.use(balancesRouter);
router.use(feesRouter);
router.use(statisticsRouter);
router.use(noticesRouter);
router.use(otpRouter);

export default router;

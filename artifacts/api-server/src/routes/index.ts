import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import membersRouter from "./members";
import buyersRouter from "./buyers";
import virtualAccountsRouter from "./virtual_accounts";
import withdrawalsRouter from "./withdrawals";
import transactionsRouter from "./transactions";
import balancesRouter from "./balances";
import feesRouter from "./fees";
import statisticsRouter from "./statistics";
import noticesRouter from "./notices";
import otpRouter from "./otp";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(membersRouter);
router.use(buyersRouter);
router.use(virtualAccountsRouter);
router.use(withdrawalsRouter);
router.use(transactionsRouter);
router.use(balancesRouter);
router.use(feesRouter);
router.use(statisticsRouter);
router.use(noticesRouter);
router.use(otpRouter);

export default router;

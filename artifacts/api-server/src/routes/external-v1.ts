import { Router } from "express";
import identity from "./external-v1-identity.js";
import paymentIntents from "./external-v1-payment-intents.js";
import reporting from "./external-v1-reporting.js";
import members from "./external-v1-members.js";
import transactions from "./external-v1-transactions.js";
import ledger from "./external-v1-ledger.js";
import operations from "./external-v1-operations.js";

const router = Router();
router.use(
  identity,
  paymentIntents,
  reporting,
  ledger,
  members,
  transactions,
  operations,
);
export default router;

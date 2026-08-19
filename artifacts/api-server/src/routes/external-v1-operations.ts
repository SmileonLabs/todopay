import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { auditLogsTable, db } from "@workspace/db";
import { authenticated } from "./external-v1-shared.js";

const router = Router();

/**
 * Financial mutations stay fail-closed until merchant scopes, provider support,
 * and webhook delivery have been enabled in production. Publishing these routes
 * gives integrators a stable error contract without pretending that money moved.
 */
async function unavailableOperation(
  req: Request,
  res: Response,
  operation: string,
) {
  const context = await authenticated(req, res);
  if (!context) return;

  const idempotencyKey = req.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey)) {
    res.status(400).json({
      error: "A valid Idempotency-Key header is required",
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    return;
  }

  const auditId = crypto.randomUUID();
  await db.insert(auditLogsTable).values({
    actorType: "merchant_api",
    action: `${operation}.blocked`,
    resourceType: "external_financial_operation",
    resourceId: auditId,
    metadata: {
      merchantId: context.merchant.id,
      merchantCode: context.merchant.code,
      idempotencyKey,
      method: req.method,
      path: req.path,
      reason: "provider_capability_unavailable",
    },
    ipAddress: req.ip ?? null,
  });

  res.status(501).json({
    error: "This financial operation is not enabled for the merchant",
    code: "PROVIDER_CAPABILITY_UNAVAILABLE",
    operation,
    retryable: false,
    auditId,
  });
}

router.post("/external/v1/withdrawals", (req, res) =>
  unavailableOperation(req, res, "withdrawal.create"),
);
router.post("/external/v1/withdrawals/:id/approve", (req, res) =>
  unavailableOperation(req, res, "withdrawal.approve"),
);
router.post("/external/v1/withdrawals/:id/reject", (req, res) =>
  unavailableOperation(req, res, "withdrawal.reject"),
);
router.post("/external/v1/withdrawals/:id/payout", (req, res) =>
  unavailableOperation(req, res, "withdrawal.payout"),
);
router.post(
  "/external/v1/transactions/:trackingNumber/confirm-purchase",
  (req, res) => unavailableOperation(req, res, "transaction.confirm_purchase"),
);
router.post("/external/v1/balance/adjustments", (req, res) =>
  unavailableOperation(req, res, "balance.adjust"),
);
router.post("/external/v1/virtual-accounts", (req, res) =>
  unavailableOperation(req, res, "virtual_account.issue"),
);
router.post("/external/v1/members/:id/virtual-account/reissue", (req, res) =>
  unavailableOperation(req, res, "virtual_account.reissue"),
);
router.post("/external/v1/virtual-accounts/:id/revoke", (req, res) =>
  unavailableOperation(req, res, "virtual_account.revoke"),
);

export default router;

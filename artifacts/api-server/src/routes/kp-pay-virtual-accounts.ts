import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, membersTable, virtualAccountIssuancesTable, virtualAccountsTable } from "@workspace/db";
import { isPlatformAdmin, requireAdmin } from "../lib/auth";
import { writeAuditLog } from "../lib/audit";
import { KpPayClient, KpPayError } from "../lib/kp-pay-client";

const router = Router();
const bankNames: Record<string, string> = { "035": "제주은행" };

async function requirePlatform(req: Request, res: Response) {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return null; }
  if (!isPlatformAdmin(caller)) { res.status(403).json({ error: "Platform administrator required" }); return null; }
  return caller;
}

function failProvider(res: Response, error: unknown): void {
  if (error instanceof KpPayError) {
    res.status(error.status).json({ error: error.message, providerResultCode: error.resultCode ?? null });
    return;
  }
  res.status(502).json({ error: "KPPay request failed" });
}

/** Starts KPPay's account-holder and 1-won verification process. */
router.post("/platform/kp-pay/virtual-account-issuances", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const body = req.body ?? {};
  const memberId = Number(body.memberId);
  const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
  const withdrawBankCode = typeof body.withdrawBankCode === "string" ? body.withdrawBankCode.trim() : "";
  const withdrawAccount = typeof body.withdrawAccount === "string" ? body.withdrawAccount.replace(/-/g, "").trim() : "";
  const identity = typeof body.identity === "string" ? body.identity.trim() : "";
  const phoneNo = typeof body.phoneNo === "string" ? body.phoneNo.replace(/-/g, "").trim() : "";
  const holderName = typeof body.holderName === "string" ? body.holderName.trim() : "";
  const accountHolderName = typeof body.accountHolderName === "string" ? body.accountHolderName.trim() : "";
  const totalAuthNo = typeof body.totalAuthNo === "string" ? body.totalAuthNo.trim() : undefined;

  if (!Number.isSafeInteger(memberId) || !/^\d{3}$/.test(bankCode) || !/^\d{3}$/.test(withdrawBankCode)
    || !/^\d{6}$/.test(identity) || !/^\d{10,11}$/.test(phoneNo) || !withdrawAccount || !holderName || !accountHolderName) {
    res.status(400).json({ error: "Invalid virtual-account verification request" }); return;
  }
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, memberId));
  if (!member?.merchantId) { res.status(400).json({ error: "Member must belong to an active TodoPay merchant" }); return; }
  const existing = await db.select({ id: virtualAccountIssuancesTable.id }).from(virtualAccountIssuancesTable)
    .where(and(eq(virtualAccountIssuancesTable.memberId, memberId), eq(virtualAccountIssuancesTable.status, "awaiting_verification"))).limit(1);
  if (existing.length) { res.status(409).json({ error: "A virtual-account verification is already pending" }); return; }

  const client = new KpPayClient();
  try {
    const available = await client.availableVirtualAccounts([bankCode]);
    const candidate = available.vact.vacts?.find((account) => account.bankCd === bankCode);
    if (!candidate) { res.status(409).json({ error: "No KPPay virtual account is currently available for this bank" }); return; }
    const trackingNumber = `VA-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const registration = await client.requestVirtualAccountRegistration({
      mchtId: process.env.KP_PAY_MERCHANT_ID ?? "",
      account: candidate.account,
      withdrawBankCd: withdrawBankCode,
      withdrawAccount,
      identity,
      phoneNo,
      name: accountHolderName,
      holderName,
      trackId: trackingNumber,
      totalAuthNo,
      udf1: String(member.id),
      udf2: String(member.merchantId),
    });
    const authNo = registration.vact.authNo;
    if (!authNo) { res.status(502).json({ error: "KPPay did not return a verification transaction number" }); return; }
    const [issuance] = await db.insert(virtualAccountIssuancesTable).values({
      merchantId: member.merchantId,
      memberId: member.id,
      trackingNumber,
      virtualAccountNumber: candidate.account,
      virtualBankCode: bankCode,
      status: "awaiting_verification",
      providerAuthNo: authNo,
      providerIssueId: registration.vact.issueId ?? null,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    }).returning();
    await writeAuditLog(req, { actorId: caller.id, action: "kp_pay.virtual_account.verification_requested", resourceType: "virtual_account_issuance", resourceId: issuance.id, metadata: { memberId, merchantId: member.merchantId, bankCode } });
    res.status(201).json({ issuanceId: issuance.id, status: issuance.status, expiresAt: issuance.expiresAt, account: candidate.pretty ?? candidate.account, bankCode, authRequired: true });
  } catch (error) { failProvider(res, error); }
});

/** Completes the 1-won code check and only then creates an active virtual account. */
router.post("/platform/kp-pay/virtual-account-issuances/:id/confirm", async (req, res) => {
  const caller = await requirePlatform(req, res);
  if (!caller) return;
  const id = Number(req.params.id);
  const oneCertiInNo = typeof req.body?.oneCertiInNo === "string" ? req.body.oneCertiInNo.trim() : "";
  if (!Number.isSafeInteger(id) || !/^\d{4}$/.test(oneCertiInNo)) { res.status(400).json({ error: "Invalid verification code" }); return; }
  const [issuance] = await db.select().from(virtualAccountIssuancesTable).where(eq(virtualAccountIssuancesTable.id, id));
  if (!issuance) { res.status(404).json({ error: "Virtual-account issuance not found" }); return; }
  if (issuance.status !== "awaiting_verification" || !issuance.providerAuthNo || (issuance.expiresAt && issuance.expiresAt < new Date())) {
    res.status(409).json({ error: "Virtual-account issuance is no longer awaiting verification" }); return;
  }
  try {
    const confirmation = await new KpPayClient().confirmVirtualAccountRegistration({
      mchtId: process.env.KP_PAY_MERCHANT_ID ?? "", authNo: issuance.providerAuthNo, oneCertiInNo,
    });
    await db.transaction(async (tx) => {
      await tx.update(virtualAccountsTable).set({ status: "revoked" }).where(and(eq(virtualAccountsTable.memberId, issuance.memberId), eq(virtualAccountsTable.status, "active")));
      await tx.insert(virtualAccountsTable).values({
        accountNumber: confirmation.vact.account,
        bankName: bankNames[confirmation.vact.bankCd ?? issuance.virtualBankCode] ?? confirmation.vact.bankCd ?? issuance.virtualBankCode,
        status: "active", memberId: issuance.memberId, merchantId: issuance.merchantId,
      });
      await tx.update(virtualAccountIssuancesTable).set({ status: "issued", providerIssueId: confirmation.vact.issueId, verifiedAt: new Date(), updatedAt: new Date() }).where(eq(virtualAccountIssuancesTable.id, issuance.id));
    });
    await writeAuditLog(req, { actorId: caller.id, action: "kp_pay.virtual_account.issued", resourceType: "virtual_account_issuance", resourceId: issuance.id, metadata: { memberId: issuance.memberId, merchantId: issuance.merchantId, issueId: confirmation.vact.issueId } });
    res.json({ issuanceId: issuance.id, status: "issued", issueId: confirmation.vact.issueId, account: confirmation.vact.account, bankCode: confirmation.vact.bankCd ?? issuance.virtualBankCode });
  } catch (error) { failProvider(res, error); }
});

export default router;

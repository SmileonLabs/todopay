import { Router } from "express";
import { requireAdmin } from "../lib/auth.js";
import { enforceCapability } from "../lib/access-control.js";
import { appendFinancialScope, getFinancialScope } from "../lib/financial-scope.js";
import { requestTodoPay, TodoPayClientError } from "../lib/todopay-client.js";

const router = Router();

async function authorizeStatistics(req: Parameters<typeof requireAdmin>[0], res: import("express").Response) {
  const caller = await requireAdmin(req);
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  if (!enforceCapability(caller, "statistics.read", res)) return null;
  const scope = await getFinancialScope(caller);
  if (!scope.unrestricted && scope.storeCodes.length === 0) {
    res.status(403).json({
      error: "TodoPay 매장코드 연결이 필요합니다.",
      code: "FINANCIAL_SCOPE_NOT_CONFIGURED",
    });
    return null;
  }
  return scope;
}

function upstreamFailure(res: import("express").Response, error: unknown): void {
  res.status(error instanceof TodoPayClientError ? 502 : 504)
    .json({ error: "TodoPay 통계를 불러올 수 없습니다." });
}

router.get("/statistics/overview", async (req, res) => {
  const scope = await authorizeStatistics(req.headers.authorization, res);
  if (!scope) return;
  try {
    res.json(await requestTodoPay(appendFinancialScope("/statistics/overview", scope)));
  } catch (error) {
    upstreamFailure(res, error);
  }
});

router.get("/statistics/daily", async (req, res) => {
  const scope = await authorizeStatistics(req.headers.authorization, res);
  if (!scope) return;
  const query = new URLSearchParams();
  if (typeof req.query.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.startDate)) {
    query.set("startDate", req.query.startDate);
  }
  if (typeof req.query.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate)) {
    query.set("endDate", req.query.endDate);
  }
  try {
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    res.json(await requestTodoPay(
      appendFinancialScope(`/statistics/daily${suffix}`, scope),
    ));
  } catch (error) {
    upstreamFailure(res, error);
  }
});

export default router;

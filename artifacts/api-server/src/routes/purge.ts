import { Router } from "express";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  transactionsTable,
  withdrawalsTable,
  balanceRecordsTable,
  virtualAccountsTable,
  feeConfigsTable,
  noticesTable,
} from "@workspace/db";

const router = Router();

async function getCallerFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return user ?? null;
  } catch {
    return null;
  }
}

router.delete("/admin/purge-all-data", async (req, res) => {
  const caller = await getCallerFromToken(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: "인증 필요" });
  if (caller.role !== "superadmin") return res.status(403).json({ error: "슈퍼어드민만 사용 가능" });

  const t = await db.delete(transactionsTable);
  const w = await db.delete(withdrawalsTable);
  const b = await db.delete(balanceRecordsTable);
  const v = await db.delete(virtualAccountsTable);
  const f = await db.delete(feeConfigsTable);
  const n = await db.delete(noticesTable);

  req.log.info("purge-all-data executed by superadmin");
  return res.json({ ok: true, message: "모든 임시 데이터 삭제 완료" });
});

export default router;

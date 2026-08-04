import { Router } from "express";
import { db, noticesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { ListNoticesQueryParams, CreateNoticeBody, UpdateNoticeBody } from "@workspace/api-zod";
import { requireAdmin } from "../lib/auth.js";
import { enforceCapability } from "../lib/access-control.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

function formatNotice(n: typeof noticesTable.$inferSelect) {
  return {
    id: n.id,
    title: n.title,
    content: n.content,
    isPinned: n.isPinned,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt?.toISOString() ?? null,
  };
}

router.get("/notices", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "notices.read", res)) return;

  const parsed = ListNoticesQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const [notices, [{ count }]] = await Promise.all([
    db.select().from(noticesTable)
      .orderBy(desc(noticesTable.isPinned), desc(noticesTable.createdAt))
      .limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(noticesTable),
  ]);

  res.json({ items: notices.map(formatNotice), total: Number(count) });
});

router.get("/notices/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!enforceCapability(caller, "notices.read", res)) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [n] = await db.select().from(noticesTable).where(eq(noticesTable.id, id));
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatNotice(n));
});

router.post("/notices", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!enforceCapability(caller, "notices.manage", res)) return;

  const parsed = CreateNoticeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  if (!parsed.data.title.trim() || !parsed.data.content.trim()) {
    res.status(400).json({ error: "제목과 내용을 입력해주세요" }); return;
  }

  const [n] = await db.insert(noticesTable).values({
    title: parsed.data.title.trim(),
    content: parsed.data.content.trim(),
    isPinned: parsed.data.isPinned ?? false,
  }).returning();
  res.status(201).json(formatNotice(n));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "notice.create",
    resourceType: "notice",
    resourceId: n.id,
  });
});

router.patch("/notices/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!enforceCapability(caller, "notices.manage", res)) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateNoticeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const updates: Partial<typeof noticesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
  if (parsed.data.content !== undefined) updates.content = parsed.data.content.trim();
  if (parsed.data.isPinned !== undefined) updates.isPinned = parsed.data.isPinned;

  const [n] = await db.update(noticesTable).set(updates).where(eq(noticesTable.id, id)).returning();
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatNotice(n));
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "notice.update",
    resourceType: "notice",
    resourceId: n.id,
    metadata: { fields: Object.keys(updates) },
  });
});

router.delete("/notices/:id", async (req, res) => {
  const caller = await requireAdmin(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!enforceCapability(caller, "notices.manage", res)) return;

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ id: noticesTable.id }).from(noticesTable).where(eq(noticesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(noticesTable).where(eq(noticesTable.id, id));
  res.status(204).send();
  await writeAuditLog(req, {
    actorId: caller.id,
    action: "notice.delete",
    resourceType: "notice",
    resourceId: id,
  });
});

export default router;

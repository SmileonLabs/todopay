import { Router } from "express";
import { db, noticesTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { ListNoticesQueryParams, CreateNoticeBody, UpdateNoticeBody } from "@workspace/api-zod";

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
  const parsed = ListNoticesQueryParams.safeParse(req.query);
  const params = parsed.success ? parsed.data : {};
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 20);
  const offset = (page - 1) * limit;

  const [notices, [{ count }]] = await Promise.all([
    db.select().from(noticesTable).orderBy(desc(noticesTable.isPinned), desc(noticesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(noticesTable),
  ]);

  res.json({ items: notices.map(formatNotice), total: Number(count) });
});

router.post("/notices", async (req, res) => {
  const parsed = CreateNoticeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const [n] = await db.insert(noticesTable).values({
    title: parsed.data.title,
    content: parsed.data.content,
    isPinned: parsed.data.isPinned ?? false,
  }).returning();
  res.status(201).json(formatNotice(n));
});

router.get("/notices/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const [n] = await db.select().from(noticesTable).where(eq(noticesTable.id, id));
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatNotice(n));
});

router.patch("/notices/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const parsed = UpdateNoticeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const updates: Partial<typeof noticesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.isPinned !== undefined) updates.isPinned = parsed.data.isPinned;
  const [n] = await db.update(noticesTable).set(updates).where(eq(noticesTable.id, id)).returning();
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatNotice(n));
});

router.delete("/notices/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(noticesTable).where(eq(noticesTable.id, id));
  res.status(204).send();
});

export default router;

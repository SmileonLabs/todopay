import { Router } from "express";
import { db, noticesTable, adminUsersTable } from "@workspace/db";
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

async function getAdminFromToken(authHeader: string | undefined) {
  if (!authHeader) return null;
  try {
    const decoded = Buffer.from(authHeader.replace("Bearer ", ""), "base64").toString();
    const parts = decoded.split(":");
    // member tokens start with "m:" — reject them
    if (parts[0] === "m") return null;
    const id = parseInt(parts[0], 10);
    if (isNaN(id)) return null;
    const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
    return user ?? null;
  } catch {
    return null;
  }
}

// GET /notices — admin only
router.get("/notices", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

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

// GET /notices/:id — admin only
router.get("/notices/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [n] = await db.select().from(noticesTable).where(eq(noticesTable.id, id));
  if (!n) { res.status(404).json({ error: "Not found" }); return; }
  res.json(formatNotice(n));
});

// POST /notices — admin only
router.post("/notices", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = CreateNoticeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  if (!parsed.data.title.trim() || !parsed.data.content.trim()) {
    res.status(400).json({ error: "제목과 내용을 입력해주세요" });
    return;
  }

  const [n] = await db.insert(noticesTable).values({
    title: parsed.data.title.trim(),
    content: parsed.data.content.trim(),
    isPinned: parsed.data.isPinned ?? false,
  }).returning();
  res.status(201).json(formatNotice(n));
});

// PATCH /notices/:id — admin only
router.patch("/notices/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

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
});

// DELETE /notices/:id — admin only
router.delete("/notices/:id", async (req, res) => {
  const caller = await getAdminFromToken(req.headers.authorization);
  if (!caller) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [existing] = await db.select({ id: noticesTable.id }).from(noticesTable).where(eq(noticesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(noticesTable).where(eq(noticesTable.id, id));
  res.status(204).send();
});

export default router;

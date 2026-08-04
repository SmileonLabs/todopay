import { db, adminUsersTable, type AdminUser } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
export { collectDescendantIds, type OrganizationNode } from "./organization-tree.js";

export async function getDescendantUserIds(rootId: number): Promise<number[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id
      FROM admin_users
      WHERE parent_id = ${rootId}
      UNION ALL
      SELECT child.id, child.parent_id
      FROM admin_users child
      JOIN descendants parent ON child.parent_id = parent.id
    )
    SELECT id FROM descendants
  `);
  return (result as unknown as { rows: Array<{ id: number | string }> }).rows
    .map(row => Number(row.id))
    .filter(Number.isInteger);
}

export async function getScopedUserIds(
  caller: Pick<AdminUser, "id" | "role">,
  options: { includeSelf?: boolean } = {},
): Promise<number[]> {
  const includeSelf = options.includeSelf ?? false;
  if (caller.role === "superadmin") {
    const rows = await db.select({ id: adminUsersTable.id }).from(adminUsersTable);
    return rows
      .map(row => row.id)
      .filter(id => includeSelf || id !== caller.id);
  }
  const descendants = await getDescendantUserIds(caller.id);
  return includeSelf ? [caller.id, ...descendants] : descendants;
}

export async function isUserInScope(
  caller: Pick<AdminUser, "id" | "role">,
  targetId: number,
  options: { includeSelf?: boolean } = {},
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  if ((options.includeSelf ?? false) && caller.id === targetId) return true;
  return (await getDescendantUserIds(caller.id)).includes(targetId);
}

export async function hasDirectChildren(userId: number): Promise<boolean> {
  const [child] = await db
    .select({ id: adminUsersTable.id })
    .from(adminUsersTable)
    .where(eq(adminUsersTable.parentId, userId))
    .limit(1);
  return Boolean(child);
}

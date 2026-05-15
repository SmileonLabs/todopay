import { db, adminUsersTable, membersTable } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

type AdminUser = typeof adminUsersTable.$inferSelect;

/**
 * Returns accessible store IDs for a given admin user.
 * - superadmin → null (no restriction, all stores)
 * - store      → [caller.id]
 * - others     → recursive descendants with role = 'store'
 */
export async function getAccessibleStoreIds(caller: AdminUser): Promise<number[] | null> {
  if (caller.role === "superadmin") return null;
  if (caller.role === "store") return [caller.id];
  const result = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, role FROM admin_users WHERE id = ${caller.id}
      UNION ALL
      SELECT au.id, au.role FROM admin_users au
      JOIN descendants d ON au.parent_id = d.id
    )
    SELECT id FROM descendants WHERE role = 'store'
  `);
  return (result as unknown as { rows: Array<{ id: number }> }).rows.map(r => Number(r.id));
}

/**
 * Returns all store IDs that are descendants of a given org node (recursively).
 */
export async function getStoresUnderOrg(orgId: number): Promise<number[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE descendants AS (
      SELECT id, role FROM admin_users WHERE id = ${orgId}
      UNION ALL
      SELECT au.id, au.role FROM admin_users au
      JOIN descendants d ON au.parent_id = d.id
    )
    SELECT id FROM descendants WHERE role = 'store'
  `);
  return (result as unknown as { rows: Array<{ id: number }> }).rows.map(r => Number(r.id));
}

/**
 * Given a list of store IDs, resolves the effective member IDs that belong to them.
 * Returns null if storeIds is null (superadmin, no restriction).
 * Returns [] if storeIds is empty (no accessible stores).
 */
export async function getMemberIdsForStores(storeIds: number[] | null): Promise<number[] | null> {
  if (storeIds === null) return null;
  if (storeIds.length === 0) return [];
  const rows = await db.select({ id: membersTable.id })
    .from(membersTable)
    .where(inArray(membersTable.storeId, storeIds));
  return rows.map(r => r.id);
}

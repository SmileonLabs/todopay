import {
  db,
  integrationMappingsTable,
  type AdminUser,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { getScopedUserIds } from "./organization-scope.js";
import { appendFinancialScope, normalizeStoreCodes } from "./financial-scope-values.js";

export type FinancialScope = {
  unrestricted: boolean;
  storeCodes: string[];
};

export { appendFinancialScope, normalizeStoreCodes } from "./financial-scope-values.js";

export async function getFinancialScope(
  caller: Pick<AdminUser, "id" | "role">,
): Promise<FinancialScope> {
  if (caller.role === "superadmin") {
    return { unrestricted: true, storeCodes: [] };
  }

  const scopedUserIds = await getScopedUserIds(caller, { includeSelf: true });
  if (scopedUserIds.length === 0) {
    return { unrestricted: false, storeCodes: [] };
  }

  const mappings = await db
    .select({ storeCode: integrationMappingsTable.todoPayEntityId })
    .from(integrationMappingsTable)
    .where(and(
      eq(integrationMappingsTable.localEntityType, "admin_user"),
      eq(integrationMappingsTable.todoPayEntityType, "store_code"),
      eq(integrationMappingsTable.syncStatus, "active"),
      inArray(integrationMappingsTable.localEntityId, scopedUserIds),
    ));

  return {
    unrestricted: false,
    storeCodes: normalizeStoreCodes(mappings.map(mapping => mapping.storeCode)),
  };
}

export async function isFinancialScopeReady(
  caller: Pick<AdminUser, "id" | "role">,
): Promise<boolean> {
  const scope = await getFinancialScope(caller);
  return scope.unrestricted || scope.storeCodes.length > 0;
}

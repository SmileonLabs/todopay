import type { Response } from "express";
import type { AdminUser } from "@workspace/db";

export const CAPABILITIES = [
  "financial.read",
  "financial.manage",
  "withdrawals.request",
  "withdrawals.approve",
  "members.read",
  "members.manage",
  "organizations.read",
  "organizations.manage",
  "fees.read",
  "fees.manage",
  "statistics.read",
  "notices.read",
  "notices.manage",
  "otp.manage",
  "profile.manage",
] as const;

export type Capability = typeof CAPABILITIES[number];
type Permission = "readonly" | "admin" | "finance";

const READ_CAPABILITIES: Capability[] = [
  "financial.read",
  "members.read",
  "organizations.read",
  "fees.read",
  "statistics.read",
  "notices.read",
  "profile.manage",
];

const PERMISSION_CAPABILITIES: Record<Permission, ReadonlySet<Capability>> = {
  readonly: new Set(READ_CAPABILITIES),
  admin: new Set([
    ...READ_CAPABILITIES,
    "members.manage",
    "organizations.manage",
    "fees.manage",
    "notices.manage",
    "otp.manage",
  ]),
  finance: new Set([
    ...READ_CAPABILITIES,
    "withdrawals.request",
    "withdrawals.approve",
    "financial.manage",
    "otp.manage",
  ]),
};

function normalizedPermission(permission: string): Permission {
  return permission === "readonly" || permission === "finance"
    ? permission
    : "admin";
}

export function capabilitiesForUser(
  user: Pick<AdminUser, "role" | "permission">,
): Capability[] {
  if (user.role === "superadmin") return [...CAPABILITIES];
  let capabilities = [
    ...PERMISSION_CAPABILITIES[normalizedPermission(user.permission)],
  ];

  // A store is a leaf organization. It may operate only its own financial,
  // member, OTP and profile functions; organization trees and internal fee
  // policies are controlled by its parent organizations.
  if (user.role === "store") {
    const storeBlockedCapabilities = new Set<Capability>([
      "organizations.read",
      "organizations.manage",
      "fees.read",
      "fees.manage",
    ]);
    capabilities = capabilities.filter(
      capability => !storeBlockedCapabilities.has(capability),
    );
  }

  // Notices are currently global, not tenant-scoped. Only the Sellink
  // superadmin and HQ may mutate them until organization-scoped notices exist.
  if (user.role !== "hq") {
    return capabilities.filter(capability => capability !== "notices.manage");
  }
  return capabilities;
}

export function canViewMerchantContract(
  user: Pick<AdminUser, "role">,
): boolean {
  return user.role === "superadmin" || user.role === "hq";
}

export function canManageStoreMapping(
  user: Pick<AdminUser, "role">,
): boolean {
  return user.role === "superadmin"
    || user.role === "hq"
    || user.role === "distributor"
    || user.role === "agency";
}

export function hasCapability(
  user: Pick<AdminUser, "role" | "permission">,
  capability: Capability,
): boolean {
  return capabilitiesForUser(user).includes(capability);
}

export function enforceCapability(
  user: Pick<AdminUser, "role" | "permission">,
  capability: Capability,
  res: Response,
): boolean {
  if (hasCapability(user, capability)) return true;
  res.status(403).json({
    error: "Forbidden",
    code: "CAPABILITY_REQUIRED",
    requiredCapability: capability,
  });
  return false;
}

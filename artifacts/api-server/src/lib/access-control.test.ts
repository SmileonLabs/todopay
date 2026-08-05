import { describe, expect, it } from "vitest";
import {
  canManageStoreMapping,
  canViewMerchantContract,
  capabilitiesForUser,
  hasCapability,
} from "./access-control.js";

describe("access control", () => {
  it("grants superadmins every capability", () => {
    const user = { role: "superadmin", permission: "readonly" };
    expect(hasCapability(user, "organizations.manage")).toBe(true);
    expect(hasCapability(user, "withdrawals.approve")).toBe(true);
  });

  it("keeps readonly users read-only", () => {
    const user = { role: "hq", permission: "readonly" };
    expect(hasCapability(user, "organizations.read")).toBe(true);
    expect(hasCapability(user, "organizations.manage")).toBe(false);
    expect(hasCapability(user, "withdrawals.approve")).toBe(false);
  });

  it("fails closed for unknown permissions and roles", () => {
    expect(hasCapability(
      { role: "hq", permission: "unexpected" },
      "organizations.manage",
    )).toBe(false);
    expect(capabilitiesForUser({ role: "unexpected", permission: "admin" }))
      .toEqual([]);
  });

  it("separates administrative and financial mutation rights", () => {
    const admin = { role: "hq", permission: "admin" };
    const finance = { role: "hq", permission: "finance" };
    expect(hasCapability(admin, "organizations.manage")).toBe(true);
    expect(hasCapability(admin, "withdrawals.approve")).toBe(false);
    expect(hasCapability(finance, "organizations.manage")).toBe(false);
    expect(hasCapability(finance, "withdrawals.approve")).toBe(true);
  });

  it("does not return duplicate capabilities", () => {
    const values = capabilitiesForUser({ role: "agency", permission: "admin" });
    expect(new Set(values).size).toBe(values.length);
  });

  it("limits global notice management to superadmin and HQ admins", () => {
    expect(hasCapability(
      { role: "superadmin", permission: "readonly" },
      "notices.manage",
    )).toBe(true);
    expect(hasCapability(
      { role: "hq", permission: "admin" },
      "notices.manage",
    )).toBe(true);
    expect(hasCapability(
      { role: "distributor", permission: "admin" },
      "notices.manage",
    )).toBe(false);
    expect(hasCapability(
      { role: "agency", permission: "admin" },
      "notices.manage",
    )).toBe(false);
    expect(hasCapability(
      { role: "store", permission: "admin" },
      "notices.manage",
    )).toBe(false);
  });

  it("limits merchant contract details to superadmin and HQ", () => {
    expect(canViewMerchantContract({ role: "superadmin" })).toBe(true);
    expect(canViewMerchantContract({ role: "hq" })).toBe(true);
    expect(canViewMerchantContract({ role: "distributor" })).toBe(false);
    expect(canViewMerchantContract({ role: "agency" })).toBe(false);
    expect(canViewMerchantContract({ role: "store" })).toBe(false);
  });

  it("treats stores as leaf organizations", () => {
    const store = { role: "store", permission: "admin" };
    expect(hasCapability(store, "financial.read")).toBe(true);
    expect(hasCapability(store, "members.read")).toBe(true);
    expect(hasCapability(store, "statistics.read")).toBe(true);
    expect(hasCapability(store, "otp.manage")).toBe(true);
    expect(hasCapability(store, "profile.manage")).toBe(true);
    expect(hasCapability(store, "organizations.read")).toBe(false);
    expect(hasCapability(store, "organizations.manage")).toBe(false);
    expect(hasCapability(store, "fees.read")).toBe(false);
    expect(hasCapability(store, "fees.manage")).toBe(false);
  });

  it("prevents stores from changing their own TodoPay mapping", () => {
    expect(canManageStoreMapping({ role: "superadmin" })).toBe(true);
    expect(canManageStoreMapping({ role: "hq" })).toBe(true);
    expect(canManageStoreMapping({ role: "distributor" })).toBe(true);
    expect(canManageStoreMapping({ role: "agency" })).toBe(true);
    expect(canManageStoreMapping({ role: "store" })).toBe(false);
  });
});

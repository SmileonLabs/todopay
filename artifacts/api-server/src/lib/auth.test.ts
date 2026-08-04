import { beforeAll, describe, expect, test } from "vitest";

process.env.DATABASE_URL ??= "postgresql://todopay:todopay_dev@127.0.0.1:55433/todopay";
process.env.SESSION_SECRET = "unit-test-session-secret";

let auth: typeof import("./auth.js");

beforeAll(async () => {
  auth = await import("./auth.js");
});

describe("signed sessions", () => {
  test("accepts a valid member session", () => {
    const token = auth.signMemberToken(42, "member42");
    expect(auth.verifyMemberToken(`Bearer ${token}`)).toEqual({ id: 42, loginId: "member42" });
  });

  test("rejects the legacy unsigned Base64 member token", () => {
    const forged = Buffer.from("m:42:member42:0").toString("base64");
    expect(auth.verifyMemberToken(`Bearer ${forged}`)).toBeNull();
  });

  test("rejects a token with a modified signature", () => {
    const token = auth.signMemberToken(42, "member42");
    expect(auth.verifyMemberToken(`Bearer ${token.slice(0, -1)}x`)).toBeNull();
  });

  test("limits financial actions to finance-capable non-store roles", () => {
    expect(auth.canManageFinance({ role: "store", permission: "finance" } as never)).toBe(false);
    expect(auth.canManageFinance({ role: "agency", permission: "readonly" } as never)).toBe(false);
    expect(auth.canManageFinance({ role: "agency", permission: "finance" } as never)).toBe(true);
    expect(auth.canManageFinance({ role: "superadmin", permission: "readonly" } as never)).toBe(true);
  });
});

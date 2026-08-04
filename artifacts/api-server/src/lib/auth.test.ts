import { beforeAll, describe, expect, test } from "vitest";

process.env.DATABASE_URL ??= "postgresql://sellink:sellink_dev@127.0.0.1:55433/sellink";
process.env.SESSION_SECRET = "sellink-unit-test-session-secret-with-sufficient-length";
delete process.env.REDIS_URL;

let auth: typeof import("./auth.js");

beforeAll(async () => {
  auth = await import("./auth.js");
});

describe("Sellink signed sessions", () => {
  test("accepts a valid signed member token", () => {
    const token = auth.signMemberToken(42, "member42");
    expect(auth.verifyMemberToken(`Bearer ${token}`)).toEqual({ id: 42, loginId: "member42" });
  });

  test("rejects the legacy unsigned Base64 member token", () => {
    const forged = Buffer.from("m:42:member42:0").toString("base64");
    expect(auth.verifyMemberToken(`Bearer ${forged}`)).toBeNull();
  });

  test("rejects a modified token signature", () => {
    const token = auth.signMemberToken(42, "member42");
    expect(auth.verifyMemberToken(`Bearer ${token.slice(0, -1)}x`)).toBeNull();
  });

  test("hashes new passwords with scrypt and verifies them", async () => {
    const hash = await auth.hashPassword("secure-password");
    expect(hash.startsWith("scrypt:")).toBe(true);
    expect(await auth.verifyPassword("secure-password", hash)).toBe(true);
    expect(await auth.verifyPassword("wrong-password", hash)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  decryptTotpSecret,
  encryptTotpSecret,
  totpCode,
  verifyTotp,
} from "./totp.js";

describe("TOTP", () => {
  it("round-trips base32 data", () => {
    const input = Buffer.from("sellink-totp");
    expect(base32Decode(base32Encode(input))).toEqual(input);
  });

  it("generates and verifies RFC6238-style codes", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const at = 1_700_000_000_000;
    const code = totpCode(secret, at);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, at)).toBe(true);
    expect(verifyTotp(secret, "000000", at)).toBe(code === "000000");
  });

  it("encrypts secrets at rest", () => {
    const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP");
    expect(encrypted).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptTotpSecret(encrypted)).toBe("JBSWY3DPEHPK3PXP");
  });
});

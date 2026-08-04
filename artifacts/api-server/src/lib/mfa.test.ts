import crypto from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";

process.env.SESSION_SECRET = "mfa-unit-test-secret-at-least-32-bytes";
process.env.DATABASE_URL ??= "postgresql://todopay:todopay_dev@127.0.0.1:55433/todopay";

let mfa: typeof import("./mfa.js");

beforeAll(async () => {
  mfa = await import("./mfa.js");
});

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function decode(secret: string): Buffer {
  let bits = "";
  for (const character of secret) {
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function codeAt(secret: string, now: number): string {
  const counter = Math.floor(now / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

describe("administrator MFA", () => {
  test("encrypts the shared secret at rest", () => {
    const secret = mfa.generateMfaSecret();
    const encrypted = mfa.encryptMfaSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(mfa.decryptMfaSecret(encrypted)).toBe(secret);
  });

  test("verifies only a six-digit code in the accepted time window", () => {
    const now = Date.UTC(2026, 6, 29, 0, 0, 0);
    const secret = mfa.generateMfaSecret();
    expect(mfa.verifyTotpCode(secret, codeAt(secret, now), now)).not.toBeNull();
    expect(mfa.verifyTotpCode(secret, "00000", now)).toBeNull();
    expect(mfa.verifyTotpCode(secret, codeAt(secret, now - 120_000), now)).toBeNull();
  });
});

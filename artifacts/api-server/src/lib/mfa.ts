import crypto from "node:crypto";
import { db, otpSettingsTable } from "@workspace/db";
import { and, eq, isNull, lt, or } from "drizzle-orm";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const stepSeconds = 30;

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for MFA secret encryption");
  return crypto.createHash("sha256").update(`todopay:mfa:${secret}`).digest();
}

function base32Encode(value: Buffer): string {
  let bits = "";
  for (const byte of value) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    output += alphabet[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

function base32Decode(value: string): Buffer {
  let bits = "";
  for (const character of value.replace(/=+$/g, "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

export function encryptMfaSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptMfaSecret(value: string): string {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    // Allows a one-time migration from the legacy plaintext field.
    return value;
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateMfaSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1_000 / stepSeconds);
  for (const offset of [-1, 0, 1]) {
    const candidate = hotp(secret, current + offset);
    if (crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) return current + offset;
  }
  return null;
}

export async function verifyUserTotp(userId: number, code: string, consume = true): Promise<boolean> {
  const [settings] = await db.select().from(otpSettingsTable)
    .where(eq(otpSettingsTable.userId, userId)).limit(1);
  if (!settings?.otpSecret || !settings.verifiedAt) return false;
  const step = verifyTotpCode(decryptMfaSecret(settings.otpSecret), code);
  if (step === null) return false;
  if (!consume) return true;
  const [updated] = await db.update(otpSettingsTable).set({ lastUsedStep: step })
    .where(and(
      eq(otpSettingsTable.userId, userId),
      or(isNull(otpSettingsTable.lastUsedStep), lt(otpSettingsTable.lastUsedStep, step)),
    )).returning({ id: otpSettingsTable.id });
  return Boolean(updated);
}

export function mfaUri(loginId: string, secret: string): string {
  const issuer = "TodoPay";
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${loginId}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

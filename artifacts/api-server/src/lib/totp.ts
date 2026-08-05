import crypto from "node:crypto";
import { config } from "../config.js";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function encryptionKey(): Buffer {
  const material = config.otpEncryptionKey || config.sessionSecret;
  if (!material) {
    if (config.isProduction) {
      throw new Error("OTP_ENCRYPTION_KEY or SESSION_SECRET must be configured");
    }
    return crypto.createHash("sha256").update("sellink-development-only-otp-key").digest();
  }
  return crypto.createHash("sha256").update(material).digest();
}

export function base32Encode(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const raw of input.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32.indexOf(raw);
    if (index < 0) throw new Error("INVALID_BASE32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret: string, timestampMs = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / STEP_SECONDS);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", base32Decode(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );
  return String(binary % (10 ** DIGITS)).padStart(DIGITS, "0");
}

export function verifyTotp(secret: string, code: string, timestampMs = Date.now()): boolean {
  return matchingTotpStep(secret, code, timestampMs) !== null;
}

export function matchingTotpStep(
  secret: string,
  code: string,
  timestampMs = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const matchingSteps = [-1, 0, 1].flatMap(offset => {
    const expected = totpCode(secret, timestampMs + offset * STEP_SECONDS * 1000);
    return crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expected))
      ? [Math.floor(timestampMs / 1000 / STEP_SECONDS) + offset]
      : [];
  });
  return matchingSteps.length > 0 ? Math.max(...matchingSteps) : null;
}

export function encryptTotpSecret(secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptTotpSecret(envelope: string): string {
  const [version, iv, tag, encrypted] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("INVALID_TOTP_ENVELOPE");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function buildOtpAuthUrl(account: string, secret: string): string {
  const issuer = "Sellink";
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    crypto.randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"));
}

export function hashRecoveryCodes(codes: string[]): string {
  return JSON.stringify(codes.map(recoveryCodeHash));
}

export function recoveryCodeHash(code: string): string {
  return crypto.createHmac("sha256", encryptionKey())
    .update(code.replace(/-/g, "").toUpperCase())
    .digest("hex");
}

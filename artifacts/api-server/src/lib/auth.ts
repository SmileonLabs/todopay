import crypto from "crypto";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { redis } from "./redis.js";

const configuredSecret = process.env.SESSION_SECRET;

if (process.env.NODE_ENV === "production" && !configuredSecret) {
  throw new Error("SESSION_SECRET must be set in production");
}

const SECRET = configuredSecret ?? "local-development-secret-not-for-production";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function signToken(id: number, loginId: string, sessionVersion = 0): string {
  const payload = `${id}:${loginId}:${Date.now()}:${sessionVersion}:${crypto.randomBytes(16).toString("hex")}`;
  const b64 = Buffer.from(payload).toString("base64");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

/** Issues a signed, expiring member session. Replaces the legacy unsigned Base64 token. */
export function signMemberToken(id: number, loginId: string): string {
  const payload = `member:${id}:${loginId}:${Date.now()}`;
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

function revokedKey(token: string): string {
  return `todopay:revoked-session:${crypto.createHash("sha256").update(token).digest("hex")}`;
}

export async function verifyToken(authHeader: string | undefined): Promise<{ id: number; loginId: string; sessionVersion: number } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (redis && await redis.exists(revokedKey(token))) return null;

  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const b64 = token.substring(0, dotIdx);
  const sig = token.substring(dotIdx + 1);

  const expectedSig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  if (sig.length !== expectedSig.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }

  const payload = Buffer.from(b64, "base64").toString();
  const parts = payload.split(":");
  if (parts.length < 3) return null;
  const id = parseInt(parts[0], 10);
  const loginId = parts[1];
  const timestamp = parseInt(parts[2], 10);
  const sessionVersion = parts.length >= 5 ? parseInt(parts[3], 10) : 0;
  if (isNaN(id) || isNaN(timestamp)) return null;
  if (isNaN(sessionVersion)) return null;
  if (Date.now() - timestamp > TOKEN_TTL_MS) return null;

  return { id, loginId, sessionVersion };
}

export function verifyMemberToken(authHeader: string | undefined): { id: number; loginId: string } | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const b64 = token.substring(0, dotIdx);
  const sig = token.substring(dotIdx + 1);
  const expectedSig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  if (sig.length !== expectedSig.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
  } catch {
    return null;
  }

  const parts = Buffer.from(b64, "base64url").toString().split(":");
  if (parts.length !== 4 || parts[0] !== "member") return null;
  const id = parseInt(parts[1], 10);
  const loginId = parts[2];
  const issuedAt = parseInt(parts[3], 10);
  if (isNaN(id) || isNaN(issuedAt) || Date.now() - issuedAt > TOKEN_TTL_MS) return null;
  return { id, loginId };
}

export async function invalidateToken(authHeader: string | undefined): Promise<void> {
  if (!authHeader?.startsWith("Bearer ")) return;
  if (!redis) return;
  const token = authHeader.slice(7);
  await redis.set(revokedKey(token), "1", "PX", TOKEN_TTL_MS);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(32).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err);
      else resolve(`scrypt:${salt}:${key.toString("hex")}`);
    });
  });
}

/** Legacy djb2-style hash used for member passwords (demo/MVP). */
export function simpleHash(password: string): string {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith("scrypt:")) {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [, salt, keyHex] = parts;
    const expected = Buffer.from(keyHex, "hex");
    return new Promise((resolve) => {
      crypto.scrypt(password, salt, KEY_LENGTH, SCRYPT_PARAMS, (err, actual) => {
        if (err) { resolve(false); return; }
        try {
          resolve(crypto.timingSafeEqual(expected, actual));
        } catch {
          resolve(false);
        }
      });
    });
  }
  return simpleHash(password) === storedHash;
}

export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= MAX_ATTEMPTS;
}

export function resetRateLimit(key: string): void {
  loginAttempts.delete(key);
}

export async function requireAdmin(
  authHeader: string | undefined,
  opts: { checkActive?: boolean } = {},
): Promise<typeof adminUsersTable.$inferSelect | null> {
  const parsed = await verifyToken(authHeader);
  if (!parsed) return null;
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parsed.id));
  if (!user) return null;
  if (opts.checkActive !== false && !user.isActive) return null;
  if (user.sessionVersion !== parsed.sessionVersion) return null;
  return user;
}

export async function requireMember(authHeader: string | undefined) {
  const parsed = verifyMemberToken(authHeader);
  if (!parsed) return null;
  const { membersTable } = await import("@workspace/db");
  const [member] = await db.select().from(membersTable).where(eq(membersTable.id, parsed.id));
  if (!member || !member.isActive || member.loginId !== parsed.loginId) return null;
  return member;
}

export function canManageFinance(caller: typeof adminUsersTable.$inferSelect): boolean {
  return caller.role !== "store" && (caller.role === "platform_admin" || caller.role === "superadmin" || caller.permission === "admin" || caller.permission === "finance");
}

/** Platform operators can cross merchant boundaries. Merchant admins never can. */
export function isPlatformAdmin(caller: typeof adminUsersTable.$inferSelect): boolean {
  return (caller.role === "platform_admin" || caller.role === "superadmin") && caller.merchantId === null;
}

export function canAccessMerchant(caller: typeof adminUsersTable.$inferSelect, merchantId: number): boolean {
  return isPlatformAdmin(caller) || caller.merchantId === merchantId;
}

export async function isAncestorOf(callerId: number, targetId: number): Promise<boolean> {
  let currentId: number | null = targetId;
  const visited = new Set<number>();
  while (currentId !== null) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const [row] = await db
      .select({ parentId: adminUsersTable.parentId })
      .from(adminUsersTable)
      .where(eq(adminUsersTable.id, currentId));
    if (!row) break;
    if (row.parentId === callerId) return true;
    currentId = row.parentId ?? null;
  }
  return false;
}

export async function canActOn(
  caller: typeof adminUsersTable.$inferSelect,
  targetId: number,
): Promise<boolean> {
  if (caller.id === targetId) return true;
  if (caller.role === "platform_admin" || caller.role === "superadmin") return true;
  return isAncestorOf(caller.id, targetId);
}

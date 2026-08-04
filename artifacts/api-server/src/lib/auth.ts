import crypto from "crypto";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { redis } from "./redis.js";
import { allowRequest, resetRequest } from "./rate-limit.js";

const configuredSecret = process.env.SESSION_SECRET;
if (process.env.NODE_ENV === "production" && !configuredSecret) {
  throw new Error("SESSION_SECRET must be configured in production");
}
const SECRET = configuredSecret ?? crypto.randomBytes(48).toString("hex");
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

const tokenBlacklist = new Set<string>();
const adminSessionNotBefore = new Map<number, number>();

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function signToken(id: number, loginId: string): string {
  const payload = `${id}:${loginId}:${Date.now()}`;
  const b64 = Buffer.from(payload).toString("base64");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

export function signMemberToken(id: number, loginId: string): string {
  const payload = Buffer.from(JSON.stringify({
    type: "member",
    id,
    loginId,
    issuedAt: Date.now(),
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyMemberToken(
  authHeader: string | undefined,
): { id: number; loginId: string } | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (tokenBlacklist.has(token)) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (signature.length !== expected.length) return null;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      type?: string;
      id?: number;
      loginId?: string;
      issuedAt?: number;
    };
    if (
      parsed.type !== "member"
      || !Number.isInteger(parsed.id)
      || typeof parsed.loginId !== "string"
      || typeof parsed.issuedAt !== "number"
      || Date.now() - parsed.issuedAt > TOKEN_TTL_MS
      || parsed.issuedAt > Date.now() + 60_000
    ) return null;
    return { id: parsed.id!, loginId: parsed.loginId };
  } catch {
    return null;
  }
}

export function verifyToken(
  authHeader: string | undefined,
): { id: number; loginId: string; issuedAt: number } | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (tokenBlacklist.has(token)) return null;

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
  if (isNaN(id) || isNaN(timestamp)) return null;
  if (Date.now() - timestamp > TOKEN_TTL_MS) return null;

  return { id, loginId, issuedAt: timestamp };
}

function tokenFingerprint(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function invalidateToken(authHeader: string | undefined): Promise<void> {
  if (!authHeader?.startsWith("Bearer ")) return;
  const token = authHeader.slice(7);
  tokenBlacklist.add(token);
  if (redis) {
    await redis.set(
      `sellink:revoked-token:${tokenFingerprint(token)}`,
      "1",
      "EX",
      Math.ceil(TOKEN_TTL_MS / 1000),
    );
  }
}

export async function isTokenInvalidated(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader?.startsWith("Bearer ")) return true;
  const token = authHeader.slice(7);
  if (tokenBlacklist.has(token)) return true;
  return redis
    ? (await redis.exists(`sellink:revoked-token:${tokenFingerprint(token)}`)) === 1
    : false;
}

export async function invalidateAdminSessions(userId: number): Promise<void> {
  const notBefore = Date.now();
  adminSessionNotBefore.set(userId, notBefore);
  if (redis) {
    await redis.set(
      `sellink:admin-session-not-before:${userId}`,
      String(notBefore),
      "EX",
      Math.ceil(TOKEN_TTL_MS / 1000),
    );
  }
}

async function isAdminSessionInvalidated(
  userId: number,
  issuedAt: number,
): Promise<boolean> {
  let notBefore = adminSessionNotBefore.get(userId) ?? null;
  if (redis) {
    const stored = await redis.get(`sellink:admin-session-not-before:${userId}`);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        notBefore = parsed;
        adminSessionNotBefore.set(userId, parsed);
      }
    }
  }
  return notBefore !== null && issuedAt <= notBefore;
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

export function isLegacyPasswordHash(storedHash: string): boolean {
  return !storedHash.startsWith("scrypt:");
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

export async function checkRateLimit(key: string, limit = MAX_ATTEMPTS): Promise<boolean> {
  return allowRequest("login", key, {
    limit,
    windowSeconds: Math.ceil(WINDOW_MS / 1000),
  });
}

export async function resetRateLimit(key: string): Promise<void> {
  await resetRequest("login", key);
}

export async function requireAdmin(
  authHeader: string | undefined,
  opts: { checkActive?: boolean } = {},
): Promise<typeof adminUsersTable.$inferSelect | null> {
  const parsed = verifyToken(authHeader);
  if (!parsed) return null;
  if (await isTokenInvalidated(authHeader)) return null;
  if (await isAdminSessionInvalidated(parsed.id, parsed.issuedAt)) return null;
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, parsed.id));
  if (!user) return null;
  if (opts.checkActive !== false && !user.isActive) return null;
  return user;
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
  if (caller.role === "superadmin") return true;
  return isAncestorOf(caller.id, targetId);
}

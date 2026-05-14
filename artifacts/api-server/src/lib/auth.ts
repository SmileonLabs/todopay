import crypto from "crypto";
import { db, adminUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const SECRET = process.env.SESSION_SECRET ?? "dev-fallback-secret-change-in-prod";
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;

const tokenBlacklist = new Set<string>();

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

export function signToken(id: number, loginId: string): string {
  const payload = `${id}:${loginId}:${Date.now()}`;
  const b64 = Buffer.from(payload).toString("base64");
  const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
  return `${b64}.${sig}`;
}

export function verifyToken(authHeader: string | undefined): { id: number; loginId: string } | null {
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

  return { id, loginId };
}

export function invalidateToken(authHeader: string | undefined): void {
  if (!authHeader?.startsWith("Bearer ")) return;
  tokenBlacklist.add(authHeader.slice(7));
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

function legacySimpleHash(password: string): string {
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
  return legacySimpleHash(password) === storedHash;
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
  const parsed = verifyToken(authHeader);
  if (!parsed) return null;
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

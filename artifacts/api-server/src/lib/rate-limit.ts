import { redis } from "./redis.js";

type RateLimitOptions = { limit: number; windowSeconds: number };
const localCounters = new Map<string, { count: number; expiresAt: number }>();

/**
 * Shared Redis limiter in deployed environments; deterministic in-memory fallback
 * keeps local development usable when Redis is intentionally absent.
 */
export async function allowRequest(scope: string, identity: string, options: RateLimitOptions): Promise<boolean> {
  const key = `todopay:rate-limit:${scope}:${identity}`;
  if (redis) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, options.windowSeconds);
    return count <= options.limit;
  }

  const now = Date.now();
  const entry = localCounters.get(key);
  if (!entry || entry.expiresAt <= now) {
    localCounters.set(key, { count: 1, expiresAt: now + options.windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= options.limit;
}

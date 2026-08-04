import { redis } from "./redis.js";

const localCounters = new Map<string, { count: number; expiresAt: number }>();

export async function allowRequest(
  scope: string,
  identity: string,
  options: { limit: number; windowSeconds: number },
): Promise<boolean> {
  const key = `sellink:rate-limit:${scope}:${identity}`;
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

export async function resetRequest(scope: string, identity: string): Promise<void> {
  const key = `sellink:rate-limit:${scope}:${identity}`;
  localCounters.delete(key);
  if (redis) await redis.del(key);
}

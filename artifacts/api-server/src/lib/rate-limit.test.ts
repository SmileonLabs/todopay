import { describe, expect, test } from "vitest";
import { allowRequest, resetRequest } from "./rate-limit.js";

describe("Sellink shared rate limiter fallback", () => {
  test("blocks after the configured number of attempts and can reset", async () => {
    const identity = `test-${Date.now()}`;
    expect(await allowRequest("test", identity, { limit: 2, windowSeconds: 60 })).toBe(true);
    expect(await allowRequest("test", identity, { limit: 2, windowSeconds: 60 })).toBe(true);
    expect(await allowRequest("test", identity, { limit: 2, windowSeconds: 60 })).toBe(false);
    await resetRequest("test", identity);
    expect(await allowRequest("test", identity, { limit: 2, windowSeconds: 60 })).toBe(true);
  });
});

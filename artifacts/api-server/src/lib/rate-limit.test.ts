import { describe, expect, test } from "vitest";
import { allowRequest } from "./rate-limit.js";

describe("rate limiter", () => {
  test("blocks requests beyond the configured limit", async () => {
    const scope = `test-${Date.now()}`;
    expect(await allowRequest(scope, "127.0.0.1", { limit: 2, windowSeconds: 60 })).toBe(true);
    expect(await allowRequest(scope, "127.0.0.1", { limit: 2, windowSeconds: 60 })).toBe(true);
    expect(await allowRequest(scope, "127.0.0.1", { limit: 2, windowSeconds: 60 })).toBe(false);
  });
});

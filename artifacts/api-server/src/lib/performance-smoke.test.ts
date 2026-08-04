import { describe, expect, it } from "vitest";
import { calculateDirectFeeShares } from "./fee-hierarchy.js";
import { collectDescendantIds } from "./organization-tree.js";

describe("performance smoke checks", () => {
  it("calculates and conserves 50,000 fee allocations within a bounded time", () => {
    const startedAt = performance.now();
    let allConserved = true;
    for (let index = 0; index < 50_000; index += 1) {
      const amount = 10_000 + index;
      const shares = calculateDirectFeeShares(amount, 10, 4, [
        { userId: 1, rate: 1.25 },
        { userId: 2, rate: 2.5 },
        { userId: 3, rate: 3.25 },
      ]);
      allConserved &&= shares.reduce((sum, item) => sum + item.amount, 0)
        === Math.round(amount * 0.1);
    }
    expect(allConserved).toBe(true);
    expect(performance.now() - startedAt).toBeLessThan(5_000);
  });

  it("walks a 20,000-node organization without recursion overflow", () => {
    const nodes = Array.from({ length: 20_000 }, (_, index) => ({
      id: index + 2,
      parentId: index + 1,
    }));
    const startedAt = performance.now();
    const result = collectDescendantIds(nodes, 1);
    expect(result).toHaveLength(20_000);
    expect(result.at(-1)).toBe(20_001);
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });
});

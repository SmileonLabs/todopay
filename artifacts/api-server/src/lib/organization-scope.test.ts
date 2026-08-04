import { describe, expect, it } from "vitest";
import { collectDescendantIds } from "./organization-tree.js";

const nodes = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: 3 },
  { id: 5, parentId: 1 },
  { id: 6, parentId: 5 },
];

describe("organization scope", () => {
  it("returns only the selected branch", () => {
    expect(collectDescendantIds(nodes, 2)).toEqual([3, 4]);
    expect(collectDescendantIds(nodes, 5)).toEqual([6]);
  });

  it("returns no self row for a leaf", () => {
    expect(collectDescendantIds(nodes, 4)).toEqual([]);
  });

  it("does not loop forever when legacy data contains a cycle", () => {
    const cyclic = [...nodes, { id: 7, parentId: 8 }, { id: 8, parentId: 7 }];
    expect(collectDescendantIds(cyclic, 7)).toEqual([8]);
  });
});

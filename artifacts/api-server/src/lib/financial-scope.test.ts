import { describe, expect, it } from "vitest";
import { appendFinancialScope, normalizeStoreCodes } from "./financial-scope-values.js";

describe("financial scope helpers", () => {
  it("normalizes and de-duplicates store codes", () => {
    expect(normalizeStoreCodes([" B ", "A", "A", ""])).toEqual(["A", "B"]);
  });

  it("adds server-derived scope without replacing existing queries", () => {
    expect(appendFinancialScope(
      "/transactions?page=2",
      { unrestricted: false, storeCodes: ["STORE_A", "STORE_B"] },
    )).toBe("/transactions?page=2&storeCodes=STORE_A%2CSTORE_B");
  });

  it("fails closed when no mapped store exists", () => {
    expect(() => appendFinancialScope(
      "/transactions",
      { unrestricted: false, storeCodes: [] },
    )).toThrow("FINANCIAL_SCOPE_NOT_CONFIGURED");
  });
});

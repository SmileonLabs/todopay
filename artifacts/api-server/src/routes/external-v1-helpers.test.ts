import { describe, expect, it } from "vitest";
import {
  dateValue,
  normalizeBirthdate,
  pageValue,
  stableJson,
  storeCodesValue,
} from "./external-v1-helpers.js";

describe("external API helpers", () => {
  it("normalizes pagination and Korean calendar dates", () => {
    expect(pageValue("20", 1, 100)).toBe(20);
    expect(pageValue("200", 1, 100)).toBe(100);
    expect(dateValue("2026-08-18")?.toISOString()).toBe(
      "2026-08-17T15:00:00.000Z",
    );
    expect(normalizeBirthdate("1990-02-28")).toBe("1990-02-28");
    expect(normalizeBirthdate("1990-02-31")).toBeNull();
  });

  it("creates deterministic request hashes and rejects malformed store scopes", () => {
    expect(stableJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(
      storeCodesValue({
        query: { storeCodes: "STORE_1, STORE_2,STORE_1" },
      } as never),
    ).toEqual(["STORE_1", "STORE_2"]);
    expect(
      storeCodesValue({ query: { storeCodes: "bad value" } } as never),
    ).toEqual([]);
  });
});

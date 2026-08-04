import { describe, expect, test } from "vitest";
import {
  escapeLike,
  maskAccount,
  maskEmail,
  maskIp,
  maskLoginId,
  maskName,
  maskPhone,
} from "./partner-payment-view.js";

describe("partner payment privacy view", () => {
  test("masks customer identifiers", () => {
    expect(maskName("곽성우")).toBe("곽*우");
    expect(maskLoginId("sellink-user")).toBe("se*****r");
    expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    expect(maskEmail("customer@example.com")).toBe("cu*****@example.com");
  });

  test("never returns a full account number", () => {
    expect(maskAccount("123456789012")).toBe("********9012");
    expect(maskAccount("1234")).toBe("****");
  });

  test("masks network addresses in audit views", () => {
    expect(maskIp("203.0.113.10")).toBe("203.0.*.*");
    expect(maskIp("2001:db8::1")).toBe("2001:db8::****");
  });

  test("escapes wildcard search input", () => {
    expect(escapeLike("order_100%")).toBe("order\\_100\\%");
  });
});

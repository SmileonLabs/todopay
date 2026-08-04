import { describe, expect, it } from "vitest";
import {
  deriveMerchantWebhookSecret,
  signMerchantWebhook,
} from "./merchant-webhook-signing";

describe("merchant webhook signing", () => {
  it("derives a stable, merchant-scoped secret", () => {
    const master = "m".repeat(32);
    const first = deriveMerchantWebhookSecret(master, "SELLINK_001", 1);
    expect(first).toBe(
      deriveMerchantWebhookSecret(master, "SELLINK_001", 1),
    );
    expect(first).not.toBe(
      deriveMerchantWebhookSecret(master, "OTHER_001", 1),
    );
    expect(first).not.toBe(
      deriveMerchantWebhookSecret(master, "SELLINK_001", 2),
    );
  });

  it("binds the signature to timestamp, event id, and exact body", () => {
    const secret = "s".repeat(43);
    const signature = signMerchantWebhook(
      secret,
      "1785168000",
      "tdp_evt_1",
      '{"ok":true}',
    );
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(signature).not.toBe(
      signMerchantWebhook(
        secret,
        "1785168000",
        "tdp_evt_1",
        '{"ok":false}',
      ),
    );
  });
});

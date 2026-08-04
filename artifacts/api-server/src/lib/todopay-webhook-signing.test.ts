import { describe, expect, it } from "vitest";
import {
  signTodoPayWebhook,
  verifyTodoPayWebhook,
} from "./todopay-webhook-signing";

describe("TodoPay webhook verification", () => {
  const secret = "s".repeat(43);
  const timestamp = "1785168000";
  const eventId = "tdp_evt_kppay_1";
  const rawBody = '{"id":"tdp_evt_kppay_1"}';
  const signatureHeader = `v1=${signTodoPayWebhook(
    secret,
    timestamp,
    eventId,
    rawBody,
  )}`;

  it("accepts a valid signature inside the replay window", () => {
    expect(
      verifyTodoPayWebhook({
        secret,
        timestamp,
        eventId,
        rawBody,
        signatureHeader,
        nowSeconds: 1785168000,
      }),
    ).toBe(true);
  });

  it("rejects tampered bodies and stale timestamps", () => {
    expect(
      verifyTodoPayWebhook({
        secret,
        timestamp,
        eventId,
        rawBody: `${rawBody} `,
        signatureHeader,
        nowSeconds: 1785168000,
      }),
    ).toBe(false);
    expect(
      verifyTodoPayWebhook({
        secret,
        timestamp,
        eventId,
        rawBody,
        signatureHeader,
        nowSeconds: 1785169000,
      }),
    ).toBe(false);
  });
});

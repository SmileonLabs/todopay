import { describe, expect, it, vi } from "vitest";
import { KpPayClient, KpPayError, type KpPayConfig } from "./kp-pay-client";

const enabled: KpPayConfig = {
  baseUrl: "https://api.kp-pay.com",
  virtualAccountPayKey: "virtual-key",
  payoutPayKey: "payout-key",
  enabled: true,
};

describe("KpPayClient", () => {
  it("uses the virtual-account key and rejects non-success provider results", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { resultCd: "9999", advanceMsg: "denied" } }), { status: 200 }));
    const client = new KpPayClient(enabled, fetcher);
    await expect(client.availableVirtualAccounts(["035"])).rejects.toMatchObject({ name: "KpPayError", resultCode: "9999" });
    expect(fetcher).toHaveBeenCalledWith("https://api.kp-pay.com/api/vact/withdrawGet", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "virtual-key" }),
    }));
  });

  it("refuses every provider call while the feature switch is disabled", async () => {
    const client = new KpPayClient({ ...enabled, enabled: false });
    await expect(client.requestPayout({ account: "123", bankCd: "004", amount: 10_000, trackId: "T-1", recordInfo: "TodoPay" }))
      .rejects.toBeInstanceOf(KpPayError);
  });

  it("sends payout requests with the payout key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: { resultCd: "0000" }, transfer: { trxId: "CS1" } }), { status: 200 }));
    const client = new KpPayClient(enabled, fetcher);
    await expect(client.requestPayout({ account: "123", bankCd: "004", amount: 10_000, trackId: "T-1", recordInfo: "TodoPay" })).resolves.toMatchObject({ transfer: { trxId: "CS1" } });
    expect(fetcher).toHaveBeenCalledWith("https://api.kp-pay.com/api/psp/settle/transfer", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "payout-key" }),
    }));
  });

  it("marks network failures as outcome-unknown so payouts are never retried blindly", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network reset"));
    const client = new KpPayClient(enabled, fetcher);
    await expect(client.requestPayout({
      account: "123",
      bankCd: "004",
      amount: 10_000,
      trackId: "T-ambiguous",
      recordInfo: "TodoPay",
    })).rejects.toMatchObject({ name: "KpPayError", outcomeUnknown: true });
  });

  it("treats an explicit provider rejection as a known outcome", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: { resultCd: "9999", resultMsg: "rejected" },
    }), { status: 200 }));
    const client = new KpPayClient(enabled, fetcher);
    await expect(client.requestPayout({
      account: "123",
      bankCd: "004",
      amount: 10_000,
      trackId: "T-rejected",
      recordInfo: "TodoPay",
    })).rejects.toMatchObject({ name: "KpPayError", outcomeUnknown: false });
  });
});

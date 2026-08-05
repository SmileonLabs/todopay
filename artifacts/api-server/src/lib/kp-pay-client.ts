import { z } from "zod/v4";

const DEFAULT_BASE_URL = "https://api.kp-pay.com";
const REQUEST_TIMEOUT_MS = 10_000;

const providerResultSchema = z.object({
  resultCd: z.string().min(1).max(10),
  resultMsg: z.string().optional(),
  advanceMsg: z.string().optional(),
  create: z.string().optional(),
}).passthrough();

const responseSchema = z.object({ result: providerResultSchema }).passthrough();

export type KpPayConfig = {
  baseUrl: string;
  virtualAccountPayKey: string;
  payoutPayKey: string;
  enabled: boolean;
  paymentIntentTrackBindingEnabled: boolean;
};

export class KpPayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resultCode?: string,
    /**
     * True when the request may have reached KPPay but TodoPay did not receive
     * a trustworthy response. Such requests must be reconciled, never retried.
     */
    readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "KpPayError";
  }
}

export function loadKpPayConfig(env = process.env): KpPayConfig {
  return {
    baseUrl: (env.KP_PAY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    virtualAccountPayKey: env.KP_PAY_VIRTUAL_ACCOUNT_KEY ?? "",
    payoutPayKey: env.KP_PAY_PAYOUT_KEY ?? "",
    enabled: env.PAYMENT_PROVIDER_ENABLED === "true",
    paymentIntentTrackBindingEnabled:
      env.PAYMENT_PROVIDER_ENABLED === "true"
      && env.PAYMENT_INTENT_PG_TRACK_BINDING_ENABLED === "true",
  };
}

type FetchLike = typeof fetch;

/**
 * Minimal, typed adapter for the KPPay REST APIs described in the supplied
 * guides. It never logs a Pay Key and refuses live calls while the explicit
 * provider switch is off.
 */
export class KpPayClient {
  constructor(
    private readonly config: KpPayConfig = loadKpPayConfig(),
    private readonly fetcher: FetchLike = fetch,
  ) {}

  private ensureEnabled(): void {
    if (!this.config.enabled) {
      throw new KpPayError("KPPay provider calls are disabled", 503);
    }
  }

  /**
   * A no-network boundary for future payment-intent registration/update calls.
   * Returning dry_run does not reserve or alter a KPPay virtual account.
   */
  paymentIntentTrackBindingPlan(trackId: string) {
    if (!/^[-A-Za-z0-9]{1,50}$/.test(trackId)) {
      throw new KpPayError("Invalid payment intent track ID", 400);
    }
    return {
      trackId,
      mode: this.config.paymentIntentTrackBindingEnabled ? "enabled" as const : "dry_run" as const,
      providerCallExecuted: false,
    };
  }

  private async post<T>(path: string, payKey: string, body: unknown): Promise<T & { result: z.infer<typeof providerResultSchema> }> {
    this.ensureEnabled();
    if (!payKey) throw new KpPayError("KPPay Pay Key is not configured", 500);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: payKey, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      const parsed = responseSchema.safeParse(payload);
      if (!response.ok || !parsed.success || parsed.data.result.resultCd !== "0000") {
        const result = parsed.success ? parsed.data.result : undefined;
        const ambiguous = response.ok && !parsed.success;
        throw new KpPayError(
          result?.advanceMsg || result?.resultMsg || "KPPay request failed",
          response.status,
          result?.resultCd,
          ambiguous,
        );
      }
      return payload as T & { result: z.infer<typeof providerResultSchema> };
    } catch (error) {
      if (error instanceof KpPayError) throw error;
      const message = error instanceof Error && error.name === "AbortError" ? "KPPay request timed out" : "KPPay network request failed";
      throw new KpPayError(message, 502, undefined, true);
    } finally {
      clearTimeout(timeout);
    }
  }

  availableVirtualAccounts(bankCodes: string[]) {
    return this.post<{ vact: { vacts?: Array<{ bankCd: string; name: string; account: string; pretty?: string }> } }>(
      "/api/vact/withdrawGet", this.config.virtualAccountPayKey, { vact: { banks: bankCodes } },
    );
  }

  requestVirtualAccountRegistration(input: {
    mchtId: string; account: string; withdrawBankCd: string; withdrawAccount: string;
    identity: string; phoneNo: string; name: string; holderName: string; trackId: string;
    totalAuthNo?: string; regType?: string; udf1?: string; udf2?: string;
  }) {
    return this.post<{ vact: { authNo?: string; issueId?: string; account?: string; nextYn?: string } }>(
      "/api/vact/regcerti", this.config.virtualAccountPayKey, { vact: { ...input, trxType: "0" } },
    );
  }

  confirmVirtualAccountRegistration(input: { mchtId: string; authNo: string; oneCertiInNo: string }) {
    return this.post<{ vact: { issueId: string; account: string; bankCd?: string; trackId?: string } }>(
      "/api/vact/regcheck", this.config.virtualAccountPayKey, { vact: input },
    );
  }

  checkPayoutAccount(input: { account: string; bankCd: string; identity?: string }) {
    return this.post<{ accnt: { account: string; bankCd: string; bankName?: string; holder?: string } }>(
      "/api/psp/settle/check", this.config.payoutPayKey, { accnt: input },
    );
  }

  getPayoutBalance() {
    return this.post<{ balance: { balance: number; fee?: number; feeVat?: number; hold?: number; available?: number } }>(
      "/api/psp/settle/balance", this.config.payoutPayKey, { balance: {} },
    );
  }

  requestPayout(input: { account: string; bankCd: string; amount: number; trackId: string; recordInfo: string }) {
    return this.post<{ transfer: { trxId: string; fee?: number; netAmount?: number; balance?: number } }>(
      "/api/psp/settle/transfer", this.config.payoutPayKey, { transfer: input },
    );
  }
}

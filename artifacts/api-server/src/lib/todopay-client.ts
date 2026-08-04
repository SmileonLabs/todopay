import crypto from "node:crypto";

const DEFAULT_BASE_URL = "https://api.todopay.io";
// TodoPay itself allows up to 10 seconds for KPPay. Leave enough time for the
// upstream response so an in-flight registration is not mistaken for failure.
const REQUEST_TIMEOUT_MS = 15_000;

export class TodoPayClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
  }
}

function configuration() {
  const apiKey = process.env.TODOPAY_API_KEY?.trim();
  const baseUrl = (process.env.TODOPAY_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!apiKey) throw new TodoPayClientError("TodoPay API is not configured", 503, null);
  if (!/^https:\/\//.test(baseUrl)) {
    throw new TodoPayClientError("TodoPay API URL must use HTTPS", 503, null);
  }
  return { apiKey, baseUrl };
}

export function isTodoPayConfigured(): boolean {
  return Boolean(process.env.TODOPAY_API_KEY?.trim());
}

export async function requestTodoPay(
  path: string,
  options: { method?: "GET" | "POST" | "PATCH"; body?: unknown; requestId?: string } = {},
): Promise<unknown> {
  const { apiKey, baseUrl } = configuration();
  const method = options.method ?? "GET";
  const requestId = options.requestId ?? crypto.randomUUID();
  const response = await fetch(`${baseUrl}/api/external/v1${path}`, {
    method,
    headers: {
      "Accept": "application/json",
      "X-TodoPay-Api-Key": apiKey,
      "X-Request-Id": requestId,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: "Unexpected TodoPay API response" };
  if (!response.ok) {
    throw new TodoPayClientError("TodoPay API request failed", response.status, payload);
  }
  return payload;
}
